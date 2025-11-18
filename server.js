const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const app = express();

// Middleware to parse JSON and XML
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));

// TeXML webhook endpoint - handles initial call
app.post('/texml-webhook', (req, res) => {
  try {
    console.log('📞 Incoming TeXML Webhook:', req.body);
    
    // TeXML with voice recording to capture caller's speech
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Hello! Thank you for calling. This is your A I legal assistant. I'm here to help gather information about your truck accident case.
  </Say>
  <Pause length="1"/>
  <Say voice="woman" language="en-US">
    Can you please tell me your full name?
  </Say>
  <Record 
    action="/process-recording" 
    method="POST" 
    maxLength="10" 
    timeout="3"
    transcribe="true"
    transcribeCallback="/transcription"
    playBeep="false"
  />
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    console.log('✅ Sent TeXML response');
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Handle recording transcription
app.post('/transcription', async (req, res) => {
  try {
    console.log('📝 Transcription received:', req.body);
    
    const transcription = req.body.TranscriptionText || '';
    const callSid = req.body.CallSid;
    
    console.log(`🗣️ Caller said: "${transcription}"`);
    
    // TODO: Send to Voiceflow + GPT-4 for processing
    // TODO: Store in Airtable
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Transcription error:', error);
    res.status(500).send('Error');
  }
});

// Handle recording completion - transcribe with Whisper
app.post('/process-recording', async (req, res) => {
  try {
    console.log('🎙️ Recording complete:', req.body);
    
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    
    // Transcribe the recording with OpenAI Whisper
    const transcription = await transcribeWithWhisper(recordingUrl);
    console.log(`🗣️ Caller said (name): "${transcription}"`);
    
    // TODO: Store in Airtable
    // TODO: Send to Voiceflow for context
    
    // Ask the next question
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you, ${transcription}. Now, can you please describe what happened in the accident?
  </Say>
  <Record 
    action="/process-accident-details" 
    method="POST" 
    maxLength="30" 
    timeout="3"
    transcribe="false"
    playBeep="false"
  />
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    // Fallback response if transcription fails
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you. Now, can you please describe what happened in the accident?
  </Say>
  <Record 
    action="/process-accident-details" 
    method="POST" 
    maxLength="30" 
    timeout="3"
    playBeep="false"
  />
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Handle accident details recording
app.post('/process-accident-details', async (req, res) => {
  try {
    console.log('📋 Accident details received:', req.body);
    
    const recordingUrl = req.body.RecordingUrl;
    
    // Transcribe accident details
    const accidentDetails = await transcribeWithWhisper(recordingUrl);
    console.log(`📝 Accident details: "${accidentDetails}"`);
    
    // TODO: Store in Airtable with name + details
    // TODO: Send SMS/Email to lawyer via Zapier
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you for providing those details. A lawyer will review your case and contact you within 24 hours. Have a great day!
  </Say>
  <Hangup/>
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you. A lawyer will contact you soon. Goodbye!
  </Say>
  <Hangup/>
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Transcribe audio using OpenAI Whisper
async function transcribeWithWhisper(audioUrl) {
  try {
    // Download the audio file
    const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(audioResponse.data);
    
    // Create form data for Whisper API
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    
    // Call OpenAI Whisper API
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );
    
    return response.data.text.trim();
    
  } catch (error) {
    console.error('❌ Whisper transcription error:', error.response?.data || error.message);
    throw error;
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Telnyx TeXML server is running! ✅');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📞 TeXML webhook available at: /texml-webhook`);
});
