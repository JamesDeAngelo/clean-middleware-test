const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();

// Middleware - parse all request types
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: 'application/octet-stream' }));

// Log ALL incoming requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ========================================`);
  console.log(`${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query:', JSON.stringify(req.query, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================================\n');
  next();
});

// Initialize Airtable (optional)
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  try {
    airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
      .base(process.env.AIRTABLE_BASE_ID);
    console.log('✅ Airtable initialized');
  } catch (error) {
    console.error('❌ Airtable initialization failed:', error.message);
  }
}

// Store conversation history for each call
const conversations = new Map();

// System prompt - your AI's personality and logic
const SYSTEM_PROMPT = `You are an AI legal intake assistant for truck accident cases. Your job is to collect information from callers in a friendly, professional manner.

CONVERSATION FLOW:

1. Greet caller and explain you'll ask a few questions

2. Ask for the date of the accident

3. Ask where the accident happened (city, state, road)

4. Ask them to describe what happened

5. Ask if anyone was injured

6. Ask for their full name

7. Ask for their phone number

8. Thank them and let them know an attorney will contact them

RULES:

- Keep responses SHORT (1-2 sentences max)

- If you don't understand, ask them to clarify once, then move on

- Always confirm important details before moving to next question

- Be empathetic and professional

- If they've already provided info, don't ask again

- Extract structured data as you go: accident_date, location, description, injuries, caller_name, phone

When you have all the information, respond with exactly: "CONVERSATION_COMPLETE"`;

// Health check
app.get('/', (req, res) => {
  console.log('✅ Health check endpoint hit');
  res.status(200).send('🚀 GPT-4 Voice Agent Running!');
});

// Test endpoint to verify server is working
app.get('/test', (req, res) => {
  console.log('✅ Test endpoint hit');
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    conversations: conversations.size,
    openai: !!process.env.OPENAI_API_KEY,
    airtable: !!airtableBase
  });
});

// Initial webhook - start conversation (Telnyx Voice API)
app.post('/telnyx-webhook', async (req, res) => {
  try {
    console.log('========================================');
    console.log('📞 /telnyx-webhook ENDPOINT HIT');
    console.log('========================================');
    
    const eventType = req.body.data?.event_type || req.body.event_type;
    const callControlId = req.body.data?.payload?.call_control_id || req.body.payload?.call_control_id;
    const callLegId = req.body.data?.payload?.call_leg_id || req.body.payload?.call_leg_id;
    const callerPhone = req.body.data?.payload?.from || req.body.payload?.from;
    
    console.log('Raw request data:', {
      body: req.body,
      eventType,
      callControlId,
      callLegId,
      callerPhone
    });
    
    // Handle different event types
    if (eventType === 'call.initiated' || eventType === 'call.answered') {
      console.log(`📱 From: ${callerPhone}`);
      console.log(`🆔 Call Control ID: ${callControlId}`);
      console.log(`🆔 Call Leg ID: ${callLegId}`);
      
      // Use call_control_id as the conversation key
      const conversationKey = callControlId || callLegId;
      
      if (!conversationKey) {
        console.error('❌ No call_control_id or call_leg_id found in request');
        res.status(200).json({ commands: [] });
        return;
      }
      
      // Initialize conversation with greeting
      const conversationHistory = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'assistant', content: "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?" }
      ];
      
      conversations.set(conversationKey, {
        history: conversationHistory,
        phone: callerPhone,
        startTime: new Date().toISOString(),
        data: {},
        callControlId: callControlId,
        callLegId: callLegId
      });
      
      // Speak the greeting using Telnyx Call Control API
      const telnyxResponse = {
        commands: [
          {
            type: 'speak',
            payload: {
              text: "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?",
              voice: 'female',
              language: 'en-US'
            }
          },
          {
            type: 'record',
            payload: {
              format: 'mp3',
              channels: 'single',
              max_length: 60,
              play_beep: false,
              recording_status_callback: `${process.env.WEBHOOK_BASE_URL || 'https://clean-middleware-test-1.onrender.com'}/process-speech`,
              recording_status_callback_method: 'POST'
            }
          }
        ]
      };
      
      console.log('✅ Sending greeting JSON response');
      console.log('Response:', JSON.stringify(telnyxResponse, null, 2));
      
      res.status(200).json(telnyxResponse);
      
      console.log('✅ Response sent successfully');
      console.log('========================================');
      
    } else {
      // For other event types, just acknowledge
      console.log(`⚠️ Unhandled event type: ${eventType}`);
      res.status(200).json({ commands: [] });
    }
    
  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR in /telnyx-webhook');
    console.error('========================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('========================================');
    
    try {
      const telnyxResponse = {
        commands: [
          {
            type: 'speak',
            payload: {
              text: 'Sorry, there was an error. Please try again later.',
              voice: 'female',
              language: 'en-US'
            }
          },
          {
            type: 'hangup'
          }
        ]
      };
      
      res.status(200).json(telnyxResponse);
    } catch (sendError) {
      console.error('❌ Failed to send error response:', sendError);
      res.status(500).send('Internal Server Error');
    }
  }
});

// Handle user speech input (Telnyx recording webhook)
app.post('/process-speech', async (req, res) => {
  try {
    console.log('========================================');
    console.log('🎤 /process-speech ENDPOINT HIT');
    console.log('========================================');
    
    const recordingUrl = req.body.data?.recording_urls?.mp3 || req.body.recording_urls?.mp3 || req.body.recording_url;
    const callControlId = req.body.data?.call_control_id || req.body.call_control_id;
    const callLegId = req.body.data?.call_leg_id || req.body.call_leg_id;
    
    console.log(`📞 Call Control ID: ${callControlId}`);
    console.log(`📞 Call Leg ID: ${callLegId}`);
    console.log(`🎧 Recording URL: ${recordingUrl}`);
    
    // Use call_control_id as the conversation key
    const conversationKey = callControlId || callLegId;
    
    if (!conversationKey) {
      console.error('❌ No call_control_id or call_leg_id in request');
      res.status(200).json({ commands: [] });
      return;
    }
    
    const conversation = conversations.get(conversationKey);
    if (!conversation) {
      console.error('❌ Conversation not found for Call Control ID:', conversationKey);
      console.log('Available conversations:', Array.from(conversations.keys()));
      
      // Create a new conversation if it doesn't exist
      console.log('⚠️ Creating new conversation for missing Call Control ID');
      const conversationHistory = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'assistant', content: "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?" }
      ];
      
      conversations.set(conversationKey, {
        history: conversationHistory,
        phone: req.body.data?.from || 'unknown',
        startTime: new Date().toISOString(),
        data: {},
        callControlId: callControlId,
        callLegId: callLegId
      });
    }
    
    const currentConversation = conversations.get(conversationKey);
    
    if (!recordingUrl) {
      console.warn('⚠️ No recording URL provided, using placeholder');
      // Continue with empty input
      const gptResponse = await getGPTResponse(currentConversation.history);
      currentConversation.history.push({ role: 'user', content: '[no audio]' });
      currentConversation.history.push({ role: 'assistant', content: gptResponse });
      
      const telnyxResponse = {
        commands: [
          {
            type: 'speak',
            payload: {
              text: sanitizeForSpeech(gptResponse),
              voice: 'female',
              language: 'en-US'
            }
          },
          {
            type: 'record',
            payload: {
              format: 'mp3',
              channels: 'single',
              max_length: 60,
              play_beep: false,
              recording_status_callback: `${process.env.WEBHOOK_BASE_URL || 'https://clean-middleware-test-1.onrender.com'}/process-speech`,
              recording_status_callback_method: 'POST'
            }
          }
        ]
      };
      
      res.status(200).json(telnyxResponse);
      return;
    }
    
    console.log(`🎧 Transcribing audio...`);
    
    let userInput;
    try {
      userInput = await transcribeWithWhisper(recordingUrl);
      console.log(`✅ User said: "${userInput}"`);
    } catch (transcriptionError) {
      console.error('❌ Transcription failed:', transcriptionError.message);
      console.error('Transcription error stack:', transcriptionError.stack);
      userInput = "[unclear audio]";
    }
    
    // Add user message to history
    currentConversation.history.push({
      role: 'user',
      content: userInput
    });
    
    // Get GPT-4 response
    const gptResponse = await getGPTResponse(currentConversation.history);
    console.log(`🤖 GPT-4 said: "${gptResponse}"`);
    
    // Add assistant message to history
    currentConversation.history.push({
      role: 'assistant',
      content: gptResponse
    });
    
    // Check if conversation is complete
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      console.log('✅ Conversation complete - saving to Airtable');
      
      // Save to Airtable
      if (airtableBase) {
        try {
          await saveToAirtable(currentConversation);
        } catch (err) {
          console.error('⚠️ Airtable save failed:', err.message);
          console.error('Airtable error stack:', err.stack);
        }
      } else {
        console.log('⚠️ Airtable not configured, skipping save');
      }
      
      // Clean up
      conversations.delete(conversationKey);
      
      // Thank and hang up
      const telnyxResponse = {
        commands: [
          {
            type: 'speak',
            payload: {
              text: 'Thank you for providing all that information. A qualified truck accident attorney will review your case and contact you within 24 hours. Have a great day!',
              voice: 'female',
              language: 'en-US'
            }
          },
          {
            type: 'hangup'
          }
        ]
      };
      
      res.status(200).json(telnyxResponse);
      
    } else {
      // Continue conversation
      const telnyxResponse = {
        commands: [
          {
            type: 'speak',
            payload: {
              text: sanitizeForSpeech(gptResponse),
              voice: 'female',
              language: 'en-US'
            }
          },
          {
            type: 'record',
            payload: {
              format: 'mp3',
              channels: 'single',
              max_length: 60,
              play_beep: false,
              recording_status_callback: `${process.env.WEBHOOK_BASE_URL || 'https://clean-middleware-test-1.onrender.com'}/process-speech`,
              recording_status_callback_method: 'POST'
            }
          }
        ]
      };
      
      console.log('✅ Continuing conversation');
      console.log('========================================');
      
      res.status(200).json(telnyxResponse);
    }
    
  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR in /process-speech');
    console.error('========================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('========================================');
    
    try {
      const telnyxResponse = {
        commands: [
          {
            type: 'speak',
            payload: {
              text: "I'm experiencing technical difficulties. Please call back later. Goodbye.",
              voice: 'female',
              language: 'en-US'
            }
          },
          {
            type: 'hangup'
          }
        ]
      };
      
      res.status(200).json(telnyxResponse);
    } catch (sendError) {
      console.error('❌ Failed to send error response:', sendError);
      res.status(500).send('Internal Server Error');
    }
  }
});

// Get response from GPT-4
async function getGPTResponse(conversationHistory) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    console.log('🤖 Calling GPT-4 API...');
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: conversationHistory,
        max_tokens: 150,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const content = response.data.choices[0].message.content.trim();
    console.log('✅ GPT-4 response received');
    return content;
    
  } catch (error) {
    console.error('❌ GPT-4 error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error('GPT-4 error stack:', error.stack);
    }
    throw error;
  }
}

// Transcribe audio with OpenAI Whisper
async function transcribeWithWhisper(audioUrl) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    console.log(`📥 Downloading audio from: ${audioUrl}`);
    
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000
    });
    
    const audioBuffer = Buffer.from(audioResponse.data);
    console.log(`✅ Downloaded ${audioBuffer.length} bytes`);
    
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'recording.mp3',
      contentType: 'audio/mpeg'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    
    console.log(`🎤 Sending to Whisper API...`);
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        },
        timeout: 30000
      }
    );
    
    console.log('✅ Transcription received');
    return response.data.text.trim();
    
  } catch (error) {
    console.error('❌ Whisper error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error('Whisper error stack:', error.stack);
    }
    throw error;
  }
}

// Save conversation to Airtable
async function saveToAirtable(conversation) {
  try {
    // Extract key info from conversation
    const fullTranscript = conversation.history
      .filter(msg => msg.role !== 'system')
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
    
    await airtableBase('Leads').create({
      "Phone Number": conversation.phone,
      "Call Start": conversation.startTime,
      "Full Transcript": fullTranscript,
      "Status": "New",
      "Qualified": "Yes" // Can add logic to determine this
    });
    
    console.log('✅ Saved to Airtable');
  } catch (error) {
    console.error('❌ Airtable save error:', error.message);
    if (error.stack) {
      console.error('Airtable error stack:', error.stack);
    }
    throw error;
  }
}

// Sanitize text for speech
function sanitizeForSpeech(text) {
  return text
    .replace(/[<>]/g, '')
    .replace(/&/g, 'and')
    .replace(/CONVERSATION_COMPLETE/g, '')
    .substring(0, 500);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('========================================');
  console.error('❌ UNHANDLED ERROR MIDDLEWARE');
  console.error('========================================');
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);
  console.error('========================================');
  
  try {
    res.status(200).json({
      commands: [
        {
          type: 'speak',
          payload: {
            text: 'An error occurred. Goodbye.',
            voice: 'female',
            language: 'en-US'
          }
        },
        {
          type: 'hangup'
        }
      ]
    });
  } catch (sendError) {
    console.error('❌ Failed to send error response:', sendError);
    res.status(500).send('Internal Server Error');
  }
});

// Start server
const PORT = process.env.PORT || 3000;

// Verify server starts
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 GPT-4 VOICE AGENT STARTED');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📞 Webhook: /telnyx-webhook`);
  console.log(`🎤 Speech Handler: /process-speech`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`📊 Airtable: ${airtableBase ? '✅' : '⚠️'}`);
  console.log('========================================');
  console.log('✅ Server is ready to receive requests');
  console.log('========================================');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('========================================');
  console.error('❌ UNCAUGHT EXCEPTION');
  console.error('========================================');
  console.error('Error:', error);
  console.error('Stack:', error.stack);
  console.error('========================================');
  // Don't exit - let the process continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('========================================');
  console.error('❌ UNHANDLED REJECTION');
  console.error('========================================');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  if (reason instanceof Error) {
    console.error('Stack:', reason.stack);
  }
  console.error('========================================');
});
