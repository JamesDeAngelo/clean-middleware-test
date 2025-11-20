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

// Store call sessions (maps CallSid to Voiceflow user_id)
const callSessions = new Map();

// Health check
app.get('/', (req, res) => {
  res.send('🚀 Voiceflow Voice Agent Running!');
});

// Initial webhook - start Voiceflow conversation
app.post('/texml-webhook', async (req, res) => {
  try {
    console.log('========================================');
    console.log('📞 NEW CALL RECEIVED');
    console.log('========================================');
    
    const callSid = req.body.CallSid;
    const callerPhone = req.body.From;
    
    console.log(`📱 From: ${callerPhone}`);
    console.log(`🆔 Call SID: ${callSid}`);
    
    // Create a unique user ID for this call (use phone number or CallSid)
    const userId = callerPhone.replace('+', ''); // Remove + from phone number
    callSessions.set(callSid, {
      userId: userId,
      phone: callerPhone,
      startTime: new Date().toISOString()
    });
    
    // Launch Voiceflow conversation (this triggers the "Start" block)
    const voiceflowResponse = await sendToVoiceflow(userId, { type: 'launch' });
    
    console.log('🤖 Voiceflow initial response:', voiceflowResponse);
    
    // Build TeXML response from Voiceflow
    const texmlResponse = buildTexmlFromVoiceflow(voiceflowResponse);
    
    console.log('✅ Sending TeXML response');
    console.log('========================================');
    
    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    // Fallback response
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman">Sorry, there was an error. Please try again later.</Say>
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
    
    const session = callSessions.get(callSid);
    if (!session) {
      throw new Error('Session not found');
    }
    
    console.log(`🎧 Transcribing audio...`);
    
    let userInput;
    try {
      // Transcribe with Whisper
      userInput = await transcribeWithWhisper(recordingUrl);
      console.log(`✅ User said: "${userInput}"`);
    } catch (transcriptionError) {
      console.error('❌ Transcription failed:', transcriptionError.message);
      
      // Send empty/null to Voiceflow to trigger its "no reply" handler
      // This lets Voiceflow handle the error with its own prompts
      userInput = null;
    }
    
    // Send to Voiceflow (even if transcription failed)
    // Voiceflow will handle "no reply" or "no match" scenarios
    const voiceflowResponse = await sendToVoiceflow(session.userId, {
      type: userInput ? 'text' : 'no-reply',
      payload: userInput || ''
    });
    
    console.log('🤖 Voiceflow response:', JSON.stringify(voiceflowResponse, null, 2));
    
    // Build TeXML response
    const texmlResponse = buildTexmlFromVoiceflow(voiceflowResponse);
    
    console.log('✅ Sending TeXML response');
    console.log('========================================');
    
    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Critical error:', error);
    
    // Last resort fallback only for system errors
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm experiencing technical difficulties. Please call back later. Goodbye.</Say>
  <Hangup/>
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Send message to Voiceflow API
async function sendToVoiceflow(userId, action) {
  try {
    const response = await axios.post(
      `https://general-runtime.voiceflow.com/state/user/${userId}/interact`,
      { action: action },
      {
        headers: {
          'Authorization': process.env.VOICEFLOW_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Voiceflow API error:', error.response?.data || error.message);
    throw error;
  }
}

// Build TeXML from Voiceflow response
function buildTexmlFromVoiceflow(voiceflowData) {
  let texmlParts = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];
  
  let hasEnd = false;
  let messageCount = 0;
  
  // Voiceflow returns an array of trace objects
  for (const trace of voiceflowData) {
    // Only process text/speak messages
    if (trace.type === 'text' || trace.type === 'speak') {
      const text = trace.payload?.message || trace.payload?.text || '';
      if (text) {
        messageCount++;
        // Use better voice - Polly.Joanna sounds more natural than default
        texmlParts.push(`  <Say voice="Polly.Joanna" language="en-US">${sanitizeForSpeech(text)}</Say>`);
        
        // Only add pause between messages, not after the last one
        if (messageCount < voiceflowData.filter(t => t.type === 'text' || t.type === 'speak').length) {
          texmlParts.push(`  <Pause length="1"/>`);
        }
      }
    }
    
    // Check for end of conversation
    if (trace.type === 'end') {
      hasEnd = true;
    }
  }
  
  if (hasEnd) {
    // Conversation ended
    texmlParts.push(`  <Hangup/>`);
  } else {
    // Wait for user input with a slightly longer timeout for natural speech
    texmlParts.push(`  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="60" 
    timeout="4"
    playBeep="false"
  />`);
  }
  
  texmlParts.push('</Response>');
  return texmlParts.join('\n');
}

// Transcribe audio with OpenAI Whisper
async function transcribeWithWhisper(audioUrl) {
  try {
    // Download audio as a stream
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'stream',
      timeout: 30000 
    });
    
    // Prepare form data
    const formData = new FormData();
    // The stream is passed directly to the form data
    formData.append('file', audioResponse.data, {
      filename: 'recording.mp3',
      contentType: 'audio/mpeg'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    
    // Call Whisper API
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
    
    return response.data.text.trim();
    
  } catch (error) {
    console.error('❌ Whisper error:', error.response?.data || error.message);
    throw new Error('Transcription failed');
  }
}

// Sanitize text for speech
function sanitizeForSpeech(text) {
  return text
    .replace(/[<>]/g, '')
    .replace(/&/g, 'and')
    .substring(0, 500);
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 VOICEFLOW VOICE AGENT STARTED');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`📞 Webhook: /texml-webhook`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`🤖 Voiceflow: ${process.env.VOICEFLOW_API_KEY ? '✅' : '❌'}`);
  console.log('========================================');
});
