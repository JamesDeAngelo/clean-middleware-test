const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();

// Middleware
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Airtable (optional - only if you have it set up)
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
    .base(process.env.AIRTABLE_BASE_ID);
}

// Store call context in memory (upgrade to Redis later for production)
const callContext = new Map();

// Health check
app.get('/', (req, res) => {
  res.send('🚀 AI Voice Agent Running! Endpoints: /texml-webhook');
});

// Initial webhook - greet caller and ask for name
app.post('/texml-webhook', (req, res) => {
  try {
    console.log('📞 Incoming call:', req.body);
    
    const callSid = req.body.CallSid;
    const callerPhone = req.body.From;
    
    // Initialize call context
    callContext.set(callSid, {
      phone: callerPhone,
      startTime: new Date().toISOString(),
      name: null,
      accidentDetails: null
    });
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Hello! Thank you for calling. This is your A I legal assistant for truck accident cases. I'm here to help gather information about your situation.
  </Say>
  <Pause length="1"/>
  <Say voice="woman" language="en-US">
    Can you please tell me your full name?
  </Say>
  <Record 
    action="/process-name" 
    method="POST" 
    maxLength="10" 
    timeout="3"
    playBeep="false"
  />
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Process name recording
app.post('/process-name', async (req, res) => {
  try {
    console.log('🎙️ Name recording received');
    
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    
    if (!recordingUrl) {
      throw new Error('No recording URL provided');
    }
    
    // Transcribe with Whisper
    const name = await transcribeWithWhisper(recordingUrl);
    console.log(`✅ Caller name: "${name}"`);
    
    // Store in context
    const context = callContext.get(callSid) || {};
    context.name = name;
    callContext.set(callSid, context);
    
    // Ask about accident
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you, ${sanitizeForSpeech(name)}. Now, can you please describe what happened in your truck accident? Please include when it occurred and any important details.
  </Say>
  <Pause length="1"/>
  <Record 
    action="/process-accident" 
    method="POST" 
    maxLength="60" 
    timeout="4"
    playBeep="false"
  />
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error processing name:', error);
    
    // Fallback without personalization
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you. Now, can you please describe what happened in your accident?
  </Say>
  <Record 
    action="/process-accident" 
    method="POST" 
    maxLength="60" 
    timeout="4"
    playBeep="false"
  />
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Process accident details
app.post('/process-accident', async (req, res) => {
  try {
    console.log('📋 Accident recording received');
    
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    const callerPhone = req.body.From;
    
    if (!recordingUrl) {
      throw new Error('No recording URL provided');
    }
    
    // Transcribe accident details
    const accidentDetails = await transcribeWithWhisper(recordingUrl);
    console.log(`✅ Accident details: "${accidentDetails}"`);
    
    // Get full context
    const context = callContext.get(callSid) || {};
    context.accidentDetails = accidentDetails;
    context.endTime = new Date().toISOString();
    
    // Store in Airtable if configured
    if (airtableBase) {
      try {
        await airtableBase('Leads').create({
          "Caller Name": context.name || 'Unknown',
          "Phone Number": callerPhone,
          "Accident Details": accidentDetails,
          "Call SID": callSid,
          "Call Start": context.startTime,
          "Qualified": determineQualification(accidentDetails),
          "Status": "New"
        });
        console.log('✅ Saved to Airtable');
      } catch (airtableError) {
        console.error('⚠️ Airtable error:', airtableError.message);
      }
    }
    
    // Clean up context
    callContext.delete(callSid);
    
    // Thank and hang up
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you so much for sharing that information. I've recorded all the details about your case. A qualified truck accident attorney will review your information and contact you within 24 hours at the phone number you're calling from.
  </Say>
  <Pause length="1"/>
  <Say voice="woman" language="en-US">
    If you need to speak with someone urgently, please call us back anytime. Have a great day, and take care!
  </Say>
  <Hangup/>
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error processing accident:', error);
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you for the information. A lawyer will contact you soon. Goodbye!
  </Say>
  <Hangup/>
</Response>`;
    
    res.type('application/xml');
    res.send(texmlResponse);
  }
});

// Transcribe audio with OpenAI Whisper
async function transcribeWithWhisper(audioUrl) {
  try {
    console.log(`🎧 Downloading audio from: ${audioUrl.substring(0, 80)}...`);
    
    // Download audio file
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });
    
    const audioBuffer = Buffer.from(audioResponse.data);
    console.log(`📦 Audio downloaded: ${audioBuffer.length} bytes`);
    
    // Prepare form data
    const formData = new FormData();
    formData.append('file', audioBuffer, {
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
    
    const transcription = response.data.text.trim();
    console.log(`✅ Transcription successful: ${transcription.length} chars`);
    
    return transcription;
    
  } catch (error) {
    console.error('❌ Whisper error:', error.response?.data || error.message);
    throw new Error('Transcription failed');
  }
}

// Determine if lead is qualified (simple logic - enhance later)
function determineQualification(details) {
  const keywords = ['truck', 'semi', '18 wheeler', 'tractor trailer', 'commercial vehicle', 'injury', 'injured'];
  const lowerDetails = details.toLowerCase();
  
  const hasKeyword = keywords.some(keyword => lowerDetails.includes(keyword));
  return hasKeyword ? 'Yes' : 'Maybe';
}

// Sanitize text for speech (remove special chars that might confuse TTS)
function sanitizeForSpeech(text) {
  return text
    .replace(/[<>]/g, '') // Remove XML chars
    .substring(0, 100); // Limit length
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📞 Webhook: /texml-webhook`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`📊 Airtable: ${airtableBase ? '✅ Connected' : '⚠️ Not configured'}`);
});
