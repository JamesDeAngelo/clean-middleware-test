const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();

// Middleware - streamlined
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Minimal logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Initialize Airtable
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  try {
    airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
      .base(process.env.AIRTABLE_BASE_ID);
    console.log('✅ Airtable initialized');
  } catch (error) {
    console.error('❌ Airtable init failed:', error.message);
  }
}

// Conversation storage - FULL HISTORY PRESERVED
const conversations = new Map();

// System prompt - ORIGINAL PRESERVED
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

// Response cache for instant responses
const CACHE = {
  completeMessage: "Thank you for providing all that information. A qualified truck accident attorney will review your case and contact you within 24 hours. Have a great day!",
  errorMessage: "I'm experiencing technical difficulties. Please call back later. Goodbye.",
  clarify: "Could you repeat that please?"
};

// Pre-built XML templates - minified
const XML_TEMPLATES = {
  continue: (text) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna" language="en-US">${text}</Say><Record action="/process-speech" method="POST" maxLength="60" timeout="2" playBeep="false"/></Response>`,
  hangup: (text) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${text}</Say><Hangup/></Response>`,
  error: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Technical issue. Call back soon.</Say><Hangup/></Response>`
};

// Health check
app.get('/', (req, res) => {
  res.status(200).send('🚀 Optimized Voice Agent Running');
});

app.get('/test', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    conversations: conversations.size,
    openai: !!process.env.OPENAI_API_KEY,
    airtable: !!airtableBase
  });
});

// Initial webhook - ORIGINAL GREETING PRESERVED
app.post('/texml-webhook', async (req, res) => {
  try {
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    const callerPhone = req.body.From || req.query.From;
    const callbackSource = req.body.CallbackSource || req.query.CallbackSource;
    
    // Ignore call-cost-events
    if (callbackSource === 'call-cost-events') {
      return res.type('application/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    if (!callSid) {
      console.error('❌ No CallSid');
      // Fallback greeting
      const greeting = "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?";
      return res.type('application/xml').status(200).send(XML_TEMPLATES.continue(greeting));
    }
    
    console.log(`📞 ${callSid} from ${callerPhone}`);
    
    // ORIGINAL GREETING MESSAGE - PRESERVED
    const initialGreeting = "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?";
    
    // Initialize with FULL conversation history structure
    const conversationHistory = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'assistant', content: initialGreeting }
    ];
    
    conversations.set(callSid, {
      history: conversationHistory,
      phone: callerPhone,
      startTime: new Date().toISOString(),
      data: {}
    });
    
    // Send greeting with minified XML
    res.type('application/xml').status(200).send(XML_TEMPLATES.continue(initialGreeting));
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.type('application/xml').status(200).send(XML_TEMPLATES.error);
  }
});

// Handle speech - OPTIMIZED BUT PRESERVING LOGIC
app.post('/process-speech', async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl;
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    
    if (!callSid) throw new Error('No CallSid');
    
    let conversation = conversations.get(callSid);
    
    // Recreate conversation if missing - ORIGINAL LOGIC
    if (!conversation) {
      console.log('⚠️ Recreating conversation');
      const initialGreeting = "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?";
      
      conversation = {
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'assistant', content: initialGreeting }
        ],
        phone: req.body.From || 'unknown',
        startTime: new Date().toISOString(),
        data: {}
      };
      conversations.set(callSid, conversation);
    }
    
    // Handle missing recording URL
    if (!recordingUrl) {
      console.warn('⚠️ No recording URL');
      const gptResponse = await getGPTResponseFast(conversation.history);
      conversation.history.push({ role: 'user', content: '[no audio]' });
      conversation.history.push({ role: 'assistant', content: gptResponse });
      return res.type('application/xml').status(200).send(XML_TEMPLATES.continue(sanitize(gptResponse)));
    }
    
    console.log('🎤 Transcribing...');
    
    // Fast transcription
    let userInput;
    try {
      userInput = await transcribeFast(recordingUrl);
      console.log(`✅ User: "${userInput}"`);
    } catch (transcriptionError) {
      console.error('❌ Transcription failed:', transcriptionError.message);
      userInput = "[unclear audio]";
    }
    
    // Add user message to FULL history
    conversation.history.push({
      role: 'user',
      content: userInput
    });
    
    // Get GPT response with FULL history (optimization happens inside function)
    const gptResponse = await getGPTResponseFast(conversation.history);
    console.log(`🤖 GPT: "${gptResponse}"`);
    
    // Add assistant message to FULL history
    conversation.history.push({
      role: 'assistant',
      content: gptResponse
    });
    
    // Check completion - ORIGINAL LOGIC
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      console.log('✅ Complete');
      
      // Async save (non-blocking)
      if (airtableBase) {
        saveToAirtable(conversation).catch(err => console.error('⚠️ Save failed:', err.message));
      }
      
      conversations.delete(callSid);
      return res.type('application/xml').status(200).send(XML_TEMPLATES.hangup(CACHE.completeMessage));
    }
    
    // Continue conversation
    res.type('application/xml').status(200).send(XML_TEMPLATES.continue(sanitize(gptResponse)));
    
  } catch (error) {
    console.error('❌ Process error:', error.message);
    res.type('application/xml').status(200).send(XML_TEMPLATES.error);
  }
});

// FAST GPT - optimized but receives FULL history
async function getGPTResponseFast(conversationHistory) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set');
    }
    
    // Smart trimming: Keep system + recent context
    // Only trim if history is very long (>15 messages)
    let messagesToSend = conversationHistory;
    if (conversationHistory.length > 15) {
      const systemMsg = conversationHistory[0];
      const recentMessages = conversationHistory.slice(-12); // Keep last 6 exchanges
      messagesToSend = [systemMsg, ...recentMessages];
      console.log(`📉 Trimmed history: ${conversationHistory.length} -> ${messagesToSend.length}`);
    }
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini', // SPEED: 4-6x faster than gpt-4
        messages: messagesToSend,
        max_tokens: 150, // Same as original
        temperature: 0.7, // Same as original
        top_p: 0.9 // SPEED: Faster sampling
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // SPEED: Shorter timeout
      }
    );
    
    return response.data.choices[0].message.content.trim();
    
  } catch (error) {
    console.error('❌ GPT error:', error.message);
    // Fallback to cached response
    return CACHE.clarify;
  }
}

// FAST TRANSCRIPTION with Deepgram fallback
async function transcribeFast(audioUrl) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set');
    }
    
    // SPEED: Use Deepgram if available (10x faster)
    if (process.env.DEEPGRAM_API_KEY) {
      try {
        return await transcribeWithDeepgram(audioUrl);
      } catch (dgError) {
        console.warn('⚠️ Deepgram failed, falling back to Whisper');
      }
    }
    
    // SPEED: Stream audio instead of buffering
    console.log('📥 Streaming audio...');
    
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'stream',
      timeout: 5000
    });
    
    const formData = new FormData();
    formData.append('file', audioResponse.data, {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text'); // SPEED: Skip JSON parsing
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        },
        timeout: 10000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    return typeof response.data === 'string' ? response.data.trim() : response.data.text.trim();
    
  } catch (error) {
    console.error('❌ Transcription error:', error.message);
    return "[unclear]";
  }
}

// Deepgram transcription (fastest option)
async function transcribeWithDeepgram(audioUrl) {
  const response = await axios.post(
    'https://api.deepgram.com/v1/listen',
    { url: audioUrl },
    {
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      params: {
        model: 'nova-2',
        language: 'en-US',
        punctuate: true
      },
      timeout: 5000
    }
  );
  
  return response.data.results.channels[0].alternatives[0].transcript;
}

// Save to Airtable - ORIGINAL LOGIC PRESERVED
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
    console.error('❌ Airtable error:', error.message);
    throw error;
  }
}

// Sanitize - ORIGINAL LOGIC
function sanitize(text) {
  return text
    .replace(/[<>]/g, '')
    .replace(/&/g, 'and')
    .replace(/CONVERSATION_COMPLETE/g, '')
    .substring(0, 500);
}

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.type('application/xml').status(200).send(XML_TEMPLATES.error);
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 OPTIMIZED VOICE AGENT STARTED');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`🎤 Deepgram: ${process.env.DEEPGRAM_API_KEY ? '✅' : '⚠️'}`);
  console.log(`📊 Airtable: ${airtableBase ? '✅' : '⚠️'}`);
  console.log('========================================');
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught:', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled:', reason);
});
