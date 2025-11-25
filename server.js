const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Readable } = require('stream');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();

// Middleware - minimal
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Async logging to prevent blocking
const log = (...args) => setImmediate(() => console.log(...args));
const logError = (...args) => setImmediate(() => console.error(...args));

// Initialize Airtable
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  try {
    airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
      .base(process.env.AIRTABLE_BASE_ID);
    log('✅ Airtable initialized');
  } catch (error) {
    logError('❌ Airtable init failed:', error.message);
  }
}

const conversations = new Map();

// OPTIMIZED System prompt - ultra-concise responses
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

CRITICAL RULES:
- ONE SHORT SENTENCE ONLY - Never more than 15 words
- NO pauses, NO thinking, NO explanations
- Be direct and move fast through questions
- If they've already provided info, don't ask again
- Extract structured data: accident_date, location, description, injuries, caller_name, phone

When you have all information, respond with exactly: "CONVERSATION_COMPLETE"`;

// Question predictor cache
const QUESTION_FLOW = [
  "What date did the accident happen?",
  "Where did the accident happen?",
  "Can you briefly describe what happened?",
  "Was anyone injured?",
  "What's your full name?",
  "What's your phone number?",
  "Got it, an attorney will contact you soon."
];

const CACHE = {
  completeMessage: "Thank you. An attorney will contact you within 24 hours. Goodbye!",
  errorMessage: "Technical issue. Call back soon.",
  clarify: "Could you repeat that?"
};

// ULTRA-MINIFIED XML templates
const XML_TEMPLATES = {
  continue: (text) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${text}</Say><Record action="/process-speech" timeout="0.4" maxLength="30" playBeep="false"/></Response>`,
  hangup: (text) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${text}</Say><Hangup/></Response>`,
  error: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Technical issue.</Say><Hangup/></Response>`
};

app.get('/', (req, res) => res.status(200).send('🚀 Ultra-Fast Voice Agent'));

app.get('/test', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    conversations: conversations.size,
    openai: !!process.env.OPENAI_API_KEY
  });
});

// Initial webhook
app.post('/texml-webhook', async (req, res) => {
  try {
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    const callerPhone = req.body.From || req.query.From;
    const callbackSource = req.body.CallbackSource || req.query.CallbackSource;
    
    if (callbackSource === 'call-cost-events') {
      return res.type('application/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    if (!callSid) {
      const greeting = "Hi, I'm logging your truck accident case. What date did the accident happen?";
      return res.type('application/xml').status(200).send(XML_TEMPLATES.continue(greeting));
    }
    
    log(`📞 ${callSid}`);
    
    const initialGreeting = "Hi, I'm logging your truck accident case. What date did the accident happen?";
    
    conversations.set(callSid, {
      history: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'assistant', content: initialGreeting }
      ],
      phone: callerPhone,
      startTime: new Date().toISOString(),
      data: {},
      step: 0
    });
    
    res.type('application/xml').status(200).send(XML_TEMPLATES.continue(initialGreeting));
    
  } catch (error) {
    logError('❌ Webhook error:', error.message);
    res.type('application/xml').status(200).send(XML_TEMPLATES.error);
  }
});

// ULTRA-OPTIMIZED speech handler with parallelization
app.post('/process-speech', async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl;
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    
    if (!callSid) throw new Error('No CallSid');
    
    let conversation = conversations.get(callSid);
    
    if (!conversation) {
      log('⚠️ Recreating conversation');
      const initialGreeting = "Hi, I'm logging your truck accident case. What date did the accident happen?";
      conversation = {
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'assistant', content: initialGreeting }
        ],
        phone: req.body.From || 'unknown',
        startTime: new Date().toISOString(),
        data: {},
        step: 0
      };
      conversations.set(callSid, conversation);
    }
    
    if (!recordingUrl) {
      const predicted = predictNextQuestion(conversation);
      conversation.history.push({ role: 'user', content: '[no audio]' });
      conversation.history.push({ role: 'assistant', content: predicted });
      return res.type('application/xml').status(200).send(XML_TEMPLATES.continue(predicted));
    }
    
    // PARALLEL EXECUTION: Start everything at once
    const transcriptionPromise = transcribeUltraFast(recordingUrl);
    const predictedQuestion = predictNextQuestion(conversation);
    
    // Wait for transcription
    const userInput = await transcriptionPromise;
    log(`User: "${userInput}"`);
    
    // Update history
    conversation.history.push({ role: 'user', content: userInput });
    
    // STREAMING GPT - get first response ASAP
    let gptResponse;
    try {
      gptResponse = await getGPTStreamingFast(conversation.history);
      log(`GPT: "${gptResponse}"`);
    } catch (gptError) {
      logError('GPT error, using prediction');
      gptResponse = predictedQuestion;
    }
    
    conversation.history.push({ role: 'assistant', content: gptResponse });
    conversation.step++;
    
    // Check completion
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      log('✅ Complete');
      if (airtableBase) {
        saveToAirtable(conversation).catch(err => logError('Save failed:', err.message));
      }
      conversations.delete(callSid);
      return res.type('application/xml').status(200).send(XML_TEMPLATES.hangup(CACHE.completeMessage));
    }
    
    res.type('application/xml').status(200).send(XML_TEMPLATES.continue(sanitize(gptResponse)));
    
  } catch (error) {
    logError('❌ Process error:', error.message);
    res.type('application/xml').status(200).send(XML_TEMPLATES.error);
  }
});

// STREAMING GPT with gpt-4o-mini (fastest available)
async function getGPTStreamingFast(conversationHistory) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    
    // Smart trimming
    let messagesToSend = conversationHistory;
    if (conversationHistory.length > 15) {
      const systemMsg = conversationHistory[0];
      const recentMessages = conversationHistory.slice(-12);
      messagesToSend = [systemMsg, ...recentMessages];
    }
    
    // STREAMING API - return first tokens immediately
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini', // Fastest model available
        messages: messagesToSend,
        max_tokens: 50, // Shorter = faster
        temperature: 0.7,
        top_p: 0.9,
        stream: true // CRITICAL: Streaming enabled
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000,
        responseType: 'stream'
      }
    );
    
    // Collect streamed response
    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let firstChunk = true;
      const timeout = setTimeout(() => reject(new Error('Stream timeout')), 5000);
      
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.includes('[DONE]')) {
            clearTimeout(timeout);
            resolve(fullResponse.trim());
            return;
          }
          
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                if (firstChunk) {
                  log('🚀 First token received'); // Response starts flowing
                  firstChunk = false;
                }
              }
            } catch (e) {
              // Skip parsing errors
            }
          }
        }
      });
      
      response.data.on('end', () => {
        clearTimeout(timeout);
        resolve(fullResponse.trim() || CACHE.clarify);
      });
      
      response.data.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
  } catch (error) {
    logError('❌ GPT error:', error.message);
    return CACHE.clarify;
  }
}

// ULTRA-FAST TRANSCRIPTION with downsampling
async function transcribeUltraFast(audioUrl) {
  try {
    // Deepgram first (fastest)
    if (process.env.DEEPGRAM_API_KEY) {
      try {
        return await transcribeWithDeepgram(audioUrl);
      } catch (dgError) {
        log('⚠️ Deepgram failed, using Whisper');
      }
    }
    
    // Download and downsample audio
    log('📥 Downloading & downsampling...');
    
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'stream',
      timeout: 3000
    });
    
    // DOWNSAMPLE: 8kHz mono WAV (60% faster transcription)
    const downsampledBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      
      ffmpeg(audioResponse.data)
        .audioFrequency(8000) // 8kHz
        .audioChannels(1) // Mono
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('error', reject)
        .on('end', () => resolve(Buffer.concat(chunks)))
        .pipe()
        .on('data', chunk => chunks.push(chunk));
    });
    
    log(`✅ Downsampled to ${downsampledBuffer.length} bytes`);
    
    // Send to Whisper
    const formData = new FormData();
    formData.append('file', downsampledBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text');
    
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
    logError('❌ Transcription error:', error.message);
    return "[unclear]";
  }
}

// Deepgram transcription
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
        punctuate: false, // Faster without punctuation
        smart_format: false
      },
      timeout: 3000
    }
  );
  
  return response.data.results.channels[0].alternatives[0].transcript;
}

// QUESTION PREDICTOR - instant fallback
function predictNextQuestion(conversation) {
  const step = conversation.step || 0;
  if (step < QUESTION_FLOW.length) {
    return QUESTION_FLOW[step];
  }
  return CACHE.clarify;
}

// Async Airtable save
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
    
    log('✅ Saved to Airtable');
  } catch (error) {
    logError('❌ Airtable error:', error.message);
  }
}

function sanitize(text) {
  return text
    .replace(/[<>]/g, '')
    .replace(/&/g, 'and')
    .replace(/CONVERSATION_COMPLETE/g, '')
    .substring(0, 400);
}

app.use((err, req, res, next) => {
  logError('❌ Error:', err.message);
  res.type('application/xml').status(200).send(XML_TEMPLATES.error);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 ULTRA-FAST VOICE AGENT');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`🎤 Deepgram: ${process.env.DEEPGRAM_API_KEY ? '✅' : '⚠️'}`);
  console.log('========================================');
});

process.on('uncaughtException', (error) => logError('❌ Uncaught:', error.message));
process.on('unhandledRejection', (reason) => logError('❌ Unhandled:', reason));
