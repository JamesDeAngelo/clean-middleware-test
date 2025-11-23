const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
    .base(process.env.AIRTABLE_BASE_ID);
}

const conversations = new Map();

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

app.get('/', (req, res) => {
  res.send('Voice API Agent Running!');
});

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
      
      conversations.set(callSessionId, {
        callControlId,
        phone: from,
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'assistant', content: "Hi, thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?" }
        ],
        startTime: new Date().toISOString()
      });
      
      await answerCall(callControlId);
      
      setTimeout(async () => {
        await speakToCall(callControlId, "Hi, thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?");
        setTimeout(() => startRecording(callControlId, callSessionId), 100);
      }, 1000);
      
      res.status(200).send('OK');
      
    } else if (eventType === 'call.recording.saved') {
      const callControlId = data.payload.call_control_id;
      const callSessionId = data.payload.call_session_id;
      const recordingUrl = data.payload.recording_urls?.mp3;
      
      console.log('Recording saved');
      
      if (recordingUrl) {
        processRecording(callSessionId, callControlId, recordingUrl);
      }
      
      res.status(200).send('OK');
      
    } else if (eventType === 'call.hangup') {
      const callSessionId = data.payload.call_session_id;
      console.log('Call ended');
      
      const conversation = conversations.get(callSessionId);
      if (conversation && airtableBase) {
        saveToAirtable(conversation);
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

async function processRecording(callSessionId, callControlId, recordingUrl) {
  try {
    const conversation = conversations.get(callSessionId);
    if (!conversation) {
      console.error('No conversation found');
      return;
    }
    
    console.log('Transcribing...');
    
    let userInput;
    try {
      userInput = await transcribeWithWhisper(recordingUrl);
      console.log('User said:', userInput);
      
      if (!userInput || userInput.length < 2) {
        console.warn('Empty transcription');
        await speakToCall(callControlId, "Sorry, I didn't catch that. Could you please repeat?");
        setTimeout(() => startRecording(callControlId, callSessionId), 500);
        return;
      }
    } catch (err) {
      console.error('Transcription error:', err.message);
      await speakToCall(callControlId, "Sorry, I'm having trouble hearing you. Could you repeat?");
      setTimeout(() => startRecording(callControlId, callSessionId), 500);
      return;
    }
    
    conversation.history.push({ role: 'user', content: userInput });
    
    console.log('Getting GPT response...');
    const gptResponse = await getGPTResponse(conversation.history);
    console.log('GPT said:', gptResponse);
    
    conversation.history.push({ role: 'assistant', content: gptResponse });
    
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      await speakToCall(callControlId, "Thank you! A truck accident attorney will contact you within 24 hours. Have a great day!");
      setTimeout(() => hangupCall(callControlId), 3000);
    } else {
      await speakToCall(callControlId, gptResponse);
      setTimeout(() => startRecording(callControlId, callSessionId), 500);
    }
    
  } catch (error) {
    console.error('Processing error:', error.message);
  }
}

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
  console.log('Speaking:', text.substring(0, 50));
}

async function startRecording(callControlId, callSessionId) {
  try {
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
      {
        format: 'mp3',
        channels: 'single',
        max_length: 30,
        play_beep: false
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Recording started');
  } catch (error) {
    console.error('Recording error:', error.message);
  }
}

async function hangupCall(callControlId) {
  try {
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
  } catch (error) {
    console.error('Hangup error:', error.message);
  }
}

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('VOICE API AGENT STARTED');
  console.log('Port:', PORT);
  console.log('OpenAI:', process.env.OPENAI_API_KEY ? 'Set' : 'Missing');
  console.log('Telnyx:', process.env.TELNYX_API_KEY ? 'Set' : 'Missing');
  console.log('Airtable:', airtableBase ? 'Connected' : 'Not configured');
});
