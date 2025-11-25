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

// Conversation storage - trimmed to last 3 exchanges
const conversations = new Map();

// System prompt - optimized for speed
const SYSTEM_PROMPT = `You are an AI legal intake assistant for truck accident cases. Collect info efficiently.

Flow: 1) Greet 2) Accident date 3) Location 4) What happened 5) Injuries 6) Name 7) Phone 8) Confirm

Rules:
- 1-2 sentence responses MAX
- Be direct and empathetic
- Don't repeat questions
- When complete, say: "CONVERSATION_COMPLETE"`;

// Response cache for common phrases
const CACHE = {
  greeting: "Hi, thanks for calling. I'm here to log your truck accident case. I'll ask a few quick questions. First, what date did the accident happen?",
  clarify: "Could you repeat that please?",
  thanks: "Thank you for that information.",
  complete: "Thank you for providing all that information. A qualified truck accident attorney will review your case and contact you within 24 hours. Have a great day!"
};

// Pre-built XML templates
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

// Initial webhook - greeting cached
app.post('/texml-webhook', async (req, res) => {
  try {
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    const callerPhone = req.body.From || req.query.From;
    const callbackSource = req.body.CallbackSource || req.query.CallbackSource;
    
    if (callbackSource === 'call-cost-events') {
      return res.type('application/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    if (!callSid) {
      return res.type('application/xml').status(200).send(XML_TEMPLATES.continue(CACHE.greeting));
    }
    
    console.log(`📞 ${callSid} from ${callerPhone}`);
    
    // Initialize with minimal history
    conversations.set(callSid, {
      history: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'assistant', content: CACHE.greeting }
      ],
      phone: callerPhone,
      startTime: new Date().toISOString(),
      data: {}
    });
    
    res.type('application/xml').status(200).send(XML_TEMPLATES.continue(CACHE.greeting));
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.type('application/xml').status(200).send(XML_TEMPLATES.error);
  }
});

// Handle speech - PARALLELIZED
app.post('/process-speech', async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl;
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    
    if (!callSid) throw new Error('No CallSid');
    
    let conversation = conversations.get(callSid);
    if (!conversation) {
      console.log('⚠️ Creating new conversation');
      conversation = {
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'assistant', content: CACHE.greeting }
        ],
        phone: req.body.From || 'unknown',
        startTime: new Date().toISOString(),
        data: {}
      };
      conversations.set(callSid, conversation);
    }
    
    if (!recordingUrl) {
      const gptResponse = await getGPTResponseFast(conversation.history);
      updateHistory(conversation, '[no audio]', gptResponse);
      return res.type('application/xml').status(200).send(XML_TEMPLATES.continue(sanitize(gptResponse)));
    }
    
    // PARALLEL: Start transcription and prepare for GPT
    console.log('🎤 Transcribing...');
    const transcriptionPromise = transcribeFast(recordingUrl);
    
    // Wait for transcription
    const userInput = await transcriptionPromise;
    console.log(`✅ User: "${userInput}"`);
    
    // Update history and get GPT response
    updateHistory(conversation, userInput, null);
    const gptResponse = await getGPTResponseFast(conversation.history);
    console.log(`🤖 GPT: "${gptResponse}"`);
    
    updateHistory(conversation, null, gptResponse);
    
    // Check completion
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      console.log('✅ Complete');
      
      // Async save (non-blocking)
      if (airtableBase) {
        saveToAirtable(conversation).catch(err => console.error('⚠️ Save failed:', err.message));
      }
      
      conversations.delete(callSid);
      return res.type('application/xml').status(200).send(XML_TEMPLATES.hangup(CACHE.complete));
    }
    
    // Continue
    res.type('application/xml').status(200).send(XML_TEMPLATES.continue(sanitize(gptResponse)));
    
  } catch (error) {
    console.error('❌ Process error:', error.message);
    res.type('application/xml').status(200).send(XML_TEMPLATES.error);
  }
});

// FAST GPT-4 - using gpt-4o-mini with optimizations
async function getGPTResponseFast(conversationHistory) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set');
    }
    
    // Trim history to last 3 exchanges + system prompt
    const trimmedHistory = trimHistory(conversationHistory);
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini', // Much faster than gpt-4
        messages: trimmedHistory,
        max_tokens: 100,
        temperature: 0.8,
        top_p: 0.9,
        frequency_penalty: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000 // 8 second hard timeout
      }
    );
    
    return response.data.choices[0].message.content.trim();
    
  } catch (error) {
    console.error('❌ GPT error:', error.message);
    // Fallback to cached response
    return "Could you repeat that? I want to make sure I have the correct information.";
  }
}

// FAST TRANSCRIPTION - Using Deepgram or Whisper streaming
async function transcribeFast(audioUrl) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set');
    }
    
    // Option 1: Use Deepgram if available (fastest)
    if (process.env.DEEPGRAM_API_KEY) {
      return await transcribeWithDeepgram(audioUrl);
    }
    
    // Option 2: Optimized Whisper with streaming
    console.log('📥 Streaming audio...');
    
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'stream',
      timeout: 5000
    });
    
    // Create form with stream
    const formData = new FormData();
    formData.append('file', audioResponse.data, {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text'); // Faster than JSON
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        },
        timeout: 8000,
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

// DEEPGRAM transcription (optional - fastest option)
async function transcribeWithDeepgram(audioUrl) {
  try {
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
          punctuate: true,
          utterances: false
        },
        timeout: 5000
      }
    );
    
    return response.data.results.channels[0].alternatives[0].transcript;
  } catch (error) {
    console.error('❌ Deepgram error:', error.message);
    throw error;
  }
}

// Trim conversation history to last 3 exchanges
function trimHistory(history) {
  const systemMsg = history.find(m => m.role === 'system');
  const recentMessages = history.filter(m => m.role !== 'system').slice(-6); // Last 3 user+assistant pairs
  return [systemMsg, ...recentMessages];
}

// Update conversation history efficiently
function updateHistory(conversation, userMsg, assistantMsg) {
  if (userMsg) {
    conversation.history.push({ role: 'user', content: userMsg });
  }
  if (assistantMsg) {
    conversation.history.push({ role: 'assistant', content: assistantMsg });
  }
  
  // Keep only last 7 messages (1 system + 6 recent)
  if (conversation.history.length > 7) {
    const systemMsg = conversation.history.find(m => m.role === 'system');
    conversation.history = [systemMsg, ...conversation.history.slice(-6)];
  }
}

// Save to Airtable (async, non-blocking)
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

// Sanitize text - minimal processing
function sanitize(text) {
  return text
    .replace(/[<>]/g, '')
    .replace(/&/g, 'and')
    .replace(/CONVERSATION_COMPLETE/g, '')
    .substring(0, 400);
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
