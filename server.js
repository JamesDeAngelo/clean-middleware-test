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
  res.status(200).send('🚀 GPT-4 Voice Agent Running (Telnyx Voice API)!');
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

// Initial webhook - start conversation
app.post('/telnyx-webhook', async (req, res) => {
  try {
    console.log('========================================');
    console.log('📞 /telnyx-webhook ENDPOINT HIT');
    console.log('========================================');
    
    const event = req.body.data?.event_type || req.body.event_type;
    const callControlId = req.body.data?.payload?.call_control_id;
    const callSessionId = req.body.data?.payload?.call_session_id;
    const callerPhone = req.body.data?.payload?.from;
    
    console.log('Event type:', event);
    console.log('Call Control ID:', callControlId);
    console.log('Call Session ID:', callSessionId);
    console.log('From:', callerPhone);
    
    // Handle different event types
    if (event === 'call.initiated' || event === 'call.answered') {
      console.log(`📱 From: ${callerPhone}`);
      console.log(`🆔 Call Session ID: ${callSessionId}`);
      
      // Answer the call first
      if (event === 'call.initiated') {
        console.log('📞 Answering call...');
        await axios.post(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        res.status(200).json({ received: true });
        return;
      }
      
      // Initialize conversation with greeting
      const conversationHistory = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'assistant', content: "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?" }
      ];
      
      conversations.set(callSessionId, {
        history: conversationHistory,
        phone: callerPhone,
        startTime: new Date().toISOString(),
        data: {},
        callControlId: callControlId
      });
      
      // Speak the greeting
      const greetingText = "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?";
      
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
        {
          payload: greetingText,
          voice: 'female',
          language: 'en-US'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ Greeting sent, starting recording...');
      
      // Start recording after speaking
      setTimeout(async () => {
        await axios.post(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
          {
            format: 'mp3',
            channels: 'single',
            max_length: 60
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
      }, 8000); // Wait for greeting to finish
      
      res.status(200).json({ received: true });
      console.log('✅ Response sent successfully');
      console.log('========================================');
      
    } else if (event === 'call.recording.saved') {
      // Handle recording
      await handleRecording(req.body.data.payload);
      res.status(200).json({ received: true });
      
    } else if (event === 'call.speak.ended') {
      // Speech ended, start recording
      console.log('🎤 Speech ended, can start recording now');
      res.status(200).json({ received: true });
      
    } else {
      console.log(`ℹ️ Unhandled event type: ${event}`);
      res.status(200).json({ received: true });
    }
    
  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR in /telnyx-webhook');
    console.error('========================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    console.error('========================================');
    
    res.status(200).json({ received: true });
  }
});

// Handle recording
async function handleRecording(payload) {
  try {
    console.log('========================================');
    console.log('🎤 HANDLING RECORDING');
    console.log('========================================');
    
    const recordingUrl = payload.recording_urls?.mp3;
    const callSessionId = payload.call_session_id;
    const callControlId = payload.call_control_id;
    
    console.log(`📞 Call Session ID: ${callSessionId}`);
    console.log(`🎧 Recording URL: ${recordingUrl}`);
    
    const conversation = conversations.get(callSessionId);
    if (!conversation) {
      console.error('❌ Conversation not found for Session ID:', callSessionId);
      return;
    }
    
    if (!recordingUrl) {
      console.warn('⚠️ No recording URL provided');
      return;
    }
    
    console.log(`🎧 Transcribing audio...`);
    
    let userInput;
    try {
      userInput = await transcribeWithWhisper(recordingUrl);
      console.log(`✅ User said: "${userInput}"`);
    } catch (transcriptionError) {
      console.error('❌ Transcription failed:', transcriptionError.message);
      userInput = "[unclear audio]";
    }
    
    // Add user message to history
    conversation.history.push({
      role: 'user',
      content: userInput
    });
    
    // Get GPT-4 response
    const gptResponse = await getGPTResponse(conversation.history);
    console.log(`🤖 GPT-4 said: "${gptResponse}"`);
    
    // Add assistant message to history
    conversation.history.push({
      role: 'assistant',
      content: gptResponse
    });
    
    // Check if conversation is complete
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      console.log('✅ Conversation complete - saving to Airtable');
      
      // Save to Airtable
      if (airtableBase) {
        try {
          await saveToAirtable(conversation);
        } catch (err) {
          console.error('⚠️ Airtable save failed:', err.message);
        }
      } else {
        console.log('⚠️ Airtable not configured, skipping save');
      }
      
      // Thank and hang up
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
        {
          payload: "Thank you for providing all that information. A qualified truck accident attorney will review your case and contact you within 24 hours. Have a great day!",
          voice: 'female',
          language: 'en-US'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Hangup after speaking
      setTimeout(async () => {
        await axios.post(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
      }, 8000);
      
      // Clean up
      conversations.delete(callSessionId);
      
    } else {
      // Continue conversation
      const cleanResponse = sanitizeForSpeech(gptResponse);
      
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
        {
          payload: cleanResponse,
          voice: 'female',
          language: 'en-US'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Start recording again after speaking
      setTimeout(async () => {
        await axios.post(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
          {
            format: 'mp3',
            channels: 'single',
            max_length: 60
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
      }, 5000);
      
      console.log('✅ Continuing conversation');
      console.log('========================================');
    }
    
  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR in handleRecording');
    console.error('========================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    console.error('========================================');
  }
}

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
    throw error;
  }
}

// Save conversation to Airtable
async function saveToAirtable(conversation) {
  try {
    const fullTranscript = conversation.history
      .filter(msg => msg.role !== 'system')
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
    
    await airtableBase('Leads').create({
      "Phone Number": conversation.phone,
      "Call Start": conversation.startTime,
      "Full Transcript": fullTranscript,
      "Status": "New",
      "Qualified": "Yes"
    });
    
    console.log('✅ Saved to Airtable');
  } catch (error) {
    console.error('❌ Airtable save error:', error.message);
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
  console.error('========================================');
  
  res.status(200).json({ received: true });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 GPT-4 VOICE AGENT STARTED (TELNYX)');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📞 Webhook: /telnyx-webhook`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`🔑 Telnyx: ${process.env.TELNYX_API_KEY ? '✅' : '❌'}`);
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
