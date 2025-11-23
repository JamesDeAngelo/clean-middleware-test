const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

// Initialize Airtable
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
    .base(process.env.AIRTABLE_BASE_ID);
}

// Store conversations
const conversations = new Map();

// System prompt
const SYSTEM_PROMPT = `You are an AI legal intake assistant for truck accident cases. 

Ask these questions in order:
1. Date of the accident
2. Location (city, state, road)
3. Description of what happened
4. Were there injuries?
5. Their full name
6. Their phone number

RULES:
- Keep responses SHORT (1-2 sentences max)
- Be conversational and empathetic
- If they already provided info, skip that question
- When you have all 6 pieces of information, respond with exactly: "CONVERSATION_COMPLETE"`;

// Health check
app.get('/', (req, res) => {
  res.send('Voice API Agent Running!');
});

// Voice API webhook
app.post('/telnyx-webhook', async (req, res) => {
  try {
    const { data } = req.body;
    const eventType = data?.event_type;
    
    console.log('Event:', eventType);
    
    if (eventType === 'call.initiated') {
      const callControlId = data.payload.call_control_id;
      const callSessionId = data.payload.call_session_id;
      const from = data.payload.from;
      
      console.log('New call from', from);
      
      // Initialize conversation
      conversations.set(callSessionId, {
        callControlId,
        phone: from,
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'assistant', content: "Hi, thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?" }
        ],
        startTime: new Date().toISOString()
      });
      
      // Answer call
      await answerCall(callControlId);
      
      // Greet caller
      setTimeout(async () => {
        await speakToCall(callControlId, "Hi, thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?");
        
        // Start recording to get their response
        setTimeout(async () => {
          await startRecording(callControlId, callSessionId);
        }, 100);
      }, 1000);
      
      res.status(200).send('OK');
      
    } else if (eventType === 'call.recording.saved') {
      const callControlId = data.payload.call_control_id;
      const callSessionId = data.payload.call_session_id;
      const recordingUrl = data.payload.recording_urls?.mp3;
      
      console.log('Recording saved, processing...');
      
      if (recordingUrl) {
        await processRecording(callSessionId, callControlId, recordingUrl);
      }
      
      res.status(200).send('OK');
      
    } else if (eventType === 'call.hangup') {
      const callSessionId = data.payload.call_session_id;
      console.log('Call ended');
      
      // Save to Airtable
      const conversation = conversations.get(callSessionId);
      if (conversation && airtableBase) {
        await saveToAirtable(conversation);
      }
      
      conversations.delete(callSessionId);
      res.status(200).send('OK');
      
    } else {
      res.status(200).send('OK');
    }
    
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(200).send('OK');
  }
});

// Process recording
async function processRecording(callSessionId, callControlId, recordingUrl) {
  try {
    const conversation = conversations.get(callSessionId);
    if (!conversation) return;
    
    console.log('Transcribing...');
    
    // Transcribe with Whisper
    const userInput = await transcribeWithWhisper(recordingUrl);
    console.log('User said:', userInput);
    
    // Add to history
    conversation.history.push({ role: 'user', content: userInput });
    
    // Get GPT response
    const gptResponse = await getGPTResponse(conversation.history);
    console.log('GPT said:', gptResponse);
    
    // Add to history
    conversation.history.push({ role: 'assistant', content: gptResponse });
    
    // Check if done
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      await speakToCall(callControlId, "Thank you! A truck accident attorney will contact you within 24 hours. Have a great day!");
      
      setTimeout(async () => {
        await hangupCall(callControlId);
      }, 3000);
      
    } else {
      // Continue conversation
      await speakToCall(callControlId, gptResponse);
      
      // Record next response
      setTimeout(async () => {
        await startRecording(callControlId, callSessionId);
      }, 100);
    }
    
  } catch (error) {
    console.error('Processing error:', error.message);
  }
}

// Answer call
async function answerCall(callControlId) {
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
  console.log('Call answered');
}

// Speak to caller
async function speakToCall(callControlId, text) {
  await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
    {
      payload: text,
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
  console.log('Speaking:', text.substring(0, 50) + '...');
}

// Start recording
async function startRecording(callControlId, callSessionId) {
  await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
    {
      format: 'mp3',
      channels: 'single',
      max_length: 15,
      timeout: 1
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  console.log('Recording started');
}

// Hangup call
async function hangupCall(callControlId) {
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
  console.log('Call hung up');
}

// Transcribe with Whisper
async function transcribeWithWhisper(audioUrl) {
  const audioResponse = await axios.get(audioUrl, { 
    responseType: 'arraybuffer',
    timeout: 10000
  });
  
  const audioBuffer = Buffer.from(audioResponse.data);
  
  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: 'recording.mp3',
    contentType: 'audio/mpeg'
  });
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  
  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      timeout: 10000
    }
  );
  
  return response.data.text.trim();
}

// Get GPT response
async function getGPTResponse(conversationHistory) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      messages: conversationHistory,
      max_tokens: 100,
      temperature: 0.7
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );
  
  return response.data.choices[0].message.content.trim();
}

// Save to Airtable
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
    
    console.log('Saved to Airtable');
  } catch (error) {
    console.error('Airtable error:', error.message);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('VOICE API AGENT STARTED');
  console.log('Port:', PORT);
  console.log('OpenAI:', process.env.OPENAI_API_KEY ? 'Set' : 'Missing');
  console.log('Telnyx:', process.env.TELNYX_API_KEY ? 'Set' : 'Missing');
  console.log('Airtable:', airtableBase ? 'Connected' : 'Not configured');
});
