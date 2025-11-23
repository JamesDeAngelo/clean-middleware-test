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
      
      console.log('=== RECORDING SAVED EVENT ===');
      console.log('Recording URL:', recordingUrl);
      console.log('Call Session ID:', callSessionId);
      
      if (recordingUrl) {
        await processRecording(callSessionId, callControlId, recordingUrl);
      } else {
        console.error('ERROR: No recording URL provided in event!');
        console.log('Full event payload:', JSON.stringify(data.payload, null, 2));
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
    console.error('Stack:', error.stack);
    res.status(200).send('OK');
  }
});

// Process recording
async function processRecording(callSessionId, callControlId, recordingUrl) {
  try {
    const conversation = conversations.get(callSessionId);
    if (!conversation) {
      console.error('ERROR: No conversation found for session:', callSessionId);
      return;
    }
    
    console.log('=== PROCESSING RECORDING ===');
    console.log('Recording URL:', recordingUrl);
    
    // Transcribe with Whisper
    console.log('Starting transcription...');
    let userInput;
    try {
      userInput = await transcribeWithWhisper(recordingUrl);
      console.log('RAW TRANSCRIPTION RESULT:', JSON.stringify(userInput));
      console.log('Transcription length:', userInput?.length || 0);
    } catch (transcribeError) {
      console.error('TRANSCRIPTION FAILED:', transcribeError.message);
      console.error('Error details:', transcribeError.response?.data || transcribeError);
      // Ask user to repeat
      await speakToCall(callControlId, "I'm sorry, I didn't catch that. Could you please repeat your answer?");
      setTimeout(async () => {
        await startRecording(callControlId, callSessionId);
      }, 100);
      return;
    }
    
    // Check if transcription is empty or just whitespace
    if (!userInput || !userInput.trim()) {
      console.error('*** EMPTY TRANSCRIPTION DETECTED ***');
      console.log('Raw value:', JSON.stringify(userInput));
      await speakToCall(callControlId, "I didn't hear anything. Could you please speak your answer again?");
      setTimeout(async () => {
        await startRecording(callControlId, callSessionId);
      }, 100);
      return;
    }
    
    console.log('✓ User said:', userInput);
    
    // Add to history
    conversation.history.push({ role: 'user', content: userInput });
    console.log('Conversation history now has', conversation.history.length, 'messages');
    
    // Get GPT response
    console.log('Getting GPT response...');
    let gptResponse;
    try {
      gptResponse = await getGPTResponse(conversation.history);
      console.log('✓ GPT said:', gptResponse);
    } catch (gptError) {
      console.error('GPT API FAILED:', gptError.message);
      console.error('GPT error details:', gptError.response?.data || gptError);
      await speakToCall(callControlId, "I'm sorry, I'm having trouble processing that. Could you please repeat your answer?");
      setTimeout(async () => {
        await startRecording(callControlId, callSessionId);
      }, 100);
      return;
    }
    
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
    console.error('PROCESSING ERROR:', error.message);
    console.error('Stack:', error.stack);
    // Try to recover
    try {
      const conversation = conversations.get(callSessionId);
      if (conversation) {
        await speakToCall(conversation.callControlId, "I'm sorry, something went wrong. Could you please repeat your answer?");
        setTimeout(async () => {
          await startRecording(conversation.callControlId, callSessionId);
        }, 100);
      }
    } catch (recoveryError) {
      console.error('Recovery failed:', recoveryError.message);
    }
  }
}

// Answer call
async function answerCall(callControlId) {
  try {
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    console.log('Call answered');
  } catch (error) {
    console.error('Error answering call:', error.message);
    throw error;
  }
}

// Speak to caller
async function speakToCall(callControlId, text) {
  try {
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
        },
        timeout: 10000
      }
    );
    console.log('Speaking:', text.substring(0, 50) + '...');
  } catch (error) {
    console.error('Error speaking:', error.message);
    throw error;
  }
}

// Start recording
async function startRecording(callControlId, callSessionId) {
  try {
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
      {
        format: 'mp3',
        channels: 'single',
        max_length: 20,
        timeout: 3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    console.log('✓ Recording started for session:', callSessionId);
  } catch (error) {
    console.error('ERROR starting recording:', error.message);
    console.error('Recording error details:', error.response?.data || error);
    throw error;
  }
}

// Hangup call
async function hangupCall(callControlId) {
  try {
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    console.log('Call hung up');
  } catch (error) {
    console.error('Error hanging up:', error.message);
    throw error;
  }
}

// Transcribe with Whisper
async function transcribeWithWhisper(audioUrl) {
  console.log('Downloading audio from:', audioUrl);
  
  let audioResponse;
  try {
    audioResponse = await axios.get(audioUrl, { 
      responseType: 'arraybuffer',
      timeout: 20000
    });
    console.log('✓ Audio downloaded, size:', audioResponse.data.byteLength, 'bytes');
  } catch (error) {
    console.error('ERROR downloading audio:', error.message);
    console.error('Status:', error.response?.status, error.response?.statusText);
    throw new Error(`Failed to download audio: ${error.message}`);
  }
  
  const audioBuffer = Buffer.from(audioResponse.data);
  
  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: 'recording.mp3',
    contentType: 'audio/mpeg'
  });
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  
  console.log('Sending transcription request to OpenAI...');
  let response;
  try {
    response = await axios.post(
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
    console.log('✓ Transcription API response received');
  } catch (error) {
    console.error('ERROR: OpenAI transcription API failed');
    console.error('Error message:', error.message);
    console.error('Status code:', error.response?.status);
    console.error('Error details:', error.response?.data || 'No response data');
    
    if (error.response?.status === 401) {
      throw new Error('OpenAI API key is invalid or expired');
    }
    throw error;
  }
  
  const transcribedText = response.data?.text?.trim();
  
  if (!transcribedText) {
    console.error('*** WARNING: Transcription returned empty result! ***');
    console.error('Full API response:', JSON.stringify(response.data, null, 2));
    return '';
  }
  
  return transcribedText;
}

// Get GPT response
async function getGPTResponse(conversationHistory) {
  console.log('Sending GPT request with', conversationHistory.length, 'messages');
  
  try {
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
        timeout: 20000
      }
    );
    
    const content = response.data.choices[0]?.message?.content?.trim();
    
    if (!content) {
      console.error('WARNING: GPT returned empty response!');
      console.error('Full API response:', JSON.stringify(response.data, null, 2));
      return "I'm sorry, could you please repeat that?";
    }
    
    return content;
  } catch (error) {
    console.error('ERROR: OpenAI GPT API failed');
    console.error('Error message:', error.message);
    console.error('Status code:', error.response?.status);
    console.error('Error details:', error.response?.data || 'No response data');
    
    if (error.response?.status === 401) {
      throw new Error('OpenAI API key is invalid or expired');
    }
    throw error;
  }
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
    
    console.log('✓ Saved to Airtable');
  } catch (error) {
    console.error('Airtable error:', error.message);
    console.error('Airtable error details:', error.response?.data || error);
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
