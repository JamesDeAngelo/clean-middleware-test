const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();

// Middleware
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Airtable (optional)
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
    .base(process.env.AIRTABLE_BASE_ID);
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
  res.send('🚀 GPT-4 Voice Agent Running!');
});

// Initial webhook - start conversation
app.post('/texml-webhook', async (req, res) => {
  try {
    console.log('========================================');
    console.log('📞 NEW CALL RECEIVED');
    console.log('========================================');
    
    const callSid = req.body.CallSid;
    const callerPhone = req.body.From;
    
    console.log(`📱 From: ${callerPhone}`);
    console.log(`🆔 Call SID: ${callSid}`);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Initialize conversation with greeting
    const conversationHistory = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'assistant', content: "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?" }
    ];
    
    conversations.set(callSid, {
      history: conversationHistory,
      phone: callerPhone,
      startTime: new Date().toISOString(),
      data: {}
    });
    
    // Speak the greeting
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can.</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">First, can you tell me the date of the accident?</Say>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="60" 
    timeout="4"
    playBeep="false"
  />
</Response>`;
    console.log('✅ Sending greeting');
    console.log('========================================');
    
    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error in /texml-webhook:', error);
    console.error('Error stack:', error.stack);
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, there was an error. Please try again later.</Say>
  <Hangup/>
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Handle user speech input
app.post('/process-speech', async (req, res) => {
  try {
    console.log('========================================');
    console.log('🎤 SPEECH INPUT RECEIVED');
    console.log('========================================');
    
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    
    console.log(`📞 Call SID: ${callSid}`);
    console.log(`🎧 Recording URL: ${recordingUrl}`);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const conversation = conversations.get(callSid);
    if (!conversation) {
      console.error('❌ Conversation not found for CallSid:', callSid);
      console.error('Available conversations:', Array.from(conversations.keys()));
      throw new Error('Conversation not found');
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
          console.error('Airtable error stack:', err.stack);
        }
      } else {
        console.log('⚠️ Airtable not configured, skipping save');
      }
      
      // Clean up
      conversations.delete(callSid);
      
      // Thank and hang up
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for providing all that information. A qualified truck accident attorney will review your case and contact you within 24 hours. Have a great day!</Say>
  <Hangup/>
</Response>`;
      
      res.type('application/xml');
      res.send(texmlResponse);
      
    } else {
      // Continue conversation
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">${sanitizeForSpeech(gptResponse)}</Say>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="60" 
    timeout="4"
    playBeep="false"
  />
</Response>`;
      
      console.log('✅ Continuing conversation');
      console.log('========================================');
      
      res.type('application/xml');
      res.send(texmlResponse);
    }
    
  } catch (error) {
    console.error('❌ Error in /process-speech:', error);
    console.error('Error stack:', error.stack);
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm experiencing technical difficulties. Please call back later. Goodbye.</Say>
  <Hangup/>
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Get response from GPT-4
async function getGPTResponse(conversationHistory) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      const error = new Error('OPENAI_API_KEY environment variable is not set');
      console.error('❌', error.message);
      throw error;
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
    
    return response.data.choices[0].message.content.trim();
    
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
      const error = new Error('OPENAI_API_KEY environment variable is not set');
      console.error('❌', error.message);
      throw error;
    }
    
    if (!audioUrl) {
      throw new Error('RecordingUrl is missing from request');
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
    
    console.log('✅ Transcription successful');
    return response.data.text.trim();
    
  } catch (error) {
    console.error('❌ Whisper error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
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
  console.error('Unhandled error middleware:', err);
  console.error('Stack:', err.stack);
  res.status(500).send('Internal Server Error');
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 GPT-4 VOICE AGENT STARTED');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📞 Webhook: /texml-webhook`);
  console.log(`🎤 Process Speech: /process-speech`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`📊 Airtable: ${airtableBase ? '✅' : '⚠️'}`);
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
