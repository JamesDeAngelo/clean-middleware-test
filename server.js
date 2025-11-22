const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Airtable = require('airtable');

const app = express();

// Middleware - parse all request types
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: 'application/octet-stream' }));

// Log ALL incoming requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ========================================`);
  console.log(`${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query:', JSON.stringify(req.query, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================================\n');
  next();
});

// Initialize Airtable (optional)
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  try {
    airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
      .base(process.env.AIRTABLE_BASE_ID);
    console.log('✅ Airtable initialized');
  } catch (error) {
    console.error('❌ Airtable initialization failed:', error.message);
  }
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
  console.log('✅ Health check endpoint hit');
  res.status(200).send('🚀 GPT-4 Voice Agent Running!');
});

// Test endpoint to verify server is working
app.get('/test', (req, res) => {
  console.log('✅ Test endpoint hit');
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    conversations: conversations.size,
    openai: !!process.env.OPENAI_API_KEY,
    airtable: !!airtableBase
  });
});

// Initial webhook - start conversation
app.post('/texml-webhook', async (req, res) => {
  try {
    console.log('========================================');
    console.log('📞 /texml-webhook ENDPOINT HIT');
    console.log('========================================');
    
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    const callerPhone = req.body.From || req.query.From;
    const callbackSource = req.body.CallbackSource || req.query.CallbackSource;
    
    console.log('Raw request data:', {
      body: req.body,
      query: req.query,
      callSid,
      callerPhone,
      callbackSource
    });
    
    // Ignore call-cost-events and call-progress-events callbacks
    if (callbackSource === 'call-cost-events' || callbackSource === 'call-progress-events') {
      console.log(`⚠️ Ignoring ${callbackSource} callback`);
      res.type('application/xml');
      res.status(200);
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      return;
    }
    
    if (!callSid) {
      console.error('❌ No CallSid found in request');
      console.log('Available in body:', Object.keys(req.body));
      console.log('Available in query:', Object.keys(req.query));
      
      // Still send a response to keep the call alive
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hello, thank you for calling. Let me connect you.</Say>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="60" 
    timeout="4"
    playBeep="false"
  />
</Response>`;
      
      res.type('application/xml');
      res.status(200);
      res.send(texmlResponse);
      return;
    }
    
    console.log(`📱 From: ${callerPhone}`);
    console.log(`🆔 Call SID: ${callSid}`);
    
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
    
    // Speak the greeting - use shorter recording for faster processing
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can.</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">First, can you tell me the date of the accident?</Say>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="30" 
    timeout="3"
    playBeep="false"
    finishOnKey="#"
  />
</Response>`;
    
    console.log('✅ Sending greeting XML response');
    console.log('Response length:', texmlResponse.length);
    
    res.type('application/xml');
    res.status(200);
    res.send(texmlResponse);
    
    console.log('✅ Response sent successfully');
    console.log('========================================');
    
  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR in /texml-webhook');
    console.error('========================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('========================================');
    
    try {
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, there was an error. Please try again later.</Say>
  <Hangup/>
</Response>`;
      
      res.type('application/xml');
      res.status(200);
      res.send(texmlResponse);
    } catch (sendError) {
      console.error('❌ Failed to send error response:', sendError);
      res.status(500).send('Internal Server Error');
    }
  }
});

// Real-time transcription webhook from Telnyx (if enabled)
app.post('/transcription-webhook', async (req, res) => {
  try {
    const callSid = req.body.call_control_id || req.body.CallSid;
    const transcript = req.body.transcript || req.body.text || '';
    const isFinal = req.body.is_final || false;
    
    if (!callSid || !transcript) {
      res.status(200).send('OK');
      return;
    }
    
    console.log(`📝 Real-time transcript for ${callSid}: "${transcript}" (final: ${isFinal})`);
    
    // Only process final transcripts to avoid processing partial text
    if (isFinal && transcript.trim()) {
      const conversation = conversations.get(callSid);
      if (conversation) {
        // Process immediately without waiting for recording
        conversation.pendingTranscript = transcript;
        // Trigger processing
        processTranscript(callSid, transcript);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Transcription webhook error:', error.message);
    res.status(200).send('OK'); // Always return OK to Telnyx
  }
});

// Process transcript immediately (for real-time transcription)
async function processTranscript(callSid, userInput) {
  try {
    const conversation = conversations.get(callSid);
    if (!conversation) return;
    
    // Add user message
    conversation.history.push({
      role: 'user',
      content: userInput.trim()
    });
    
    // Get GPT response
    const gptResponse = await getGPTResponse(conversation.history);
    
    // Add assistant message
    conversation.history.push({
      role: 'assistant',
      content: gptResponse
    });
    
    // Store response for next webhook call
    conversation.pendingResponse = gptResponse;
    
    console.log(`✅ Processed transcript, response ready: "${gptResponse}"`);
  } catch (error) {
    console.error('❌ Error processing transcript:', error.message);
  }
}

// Handle user speech input
app.post('/process-speech', async (req, res) => {
  try {
    console.log('========================================');
    console.log('🎤 /process-speech ENDPOINT HIT');
    console.log('========================================');
    
    const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl;
    const callSid = req.body.CallSid || req.body.CallSidLegacy || req.query.CallSid;
    
    console.log(`📞 Call SID: ${callSid}`);
    console.log(`🎧 Recording URL: ${recordingUrl}`);
    
    if (!callSid) {
      console.error('❌ No CallSid in request');
      throw new Error('No CallSid in request');
    }
    
    const conversation = conversations.get(callSid);
    if (!conversation) {
      console.error('❌ Conversation not found for CallSid:', callSid);
      console.log('Available conversations:', Array.from(conversations.keys()));
      
      // Create a new conversation if it doesn't exist
      console.log('⚠️ Creating new conversation for missing CallSid');
      const conversationHistory = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'assistant', content: "Hi, thanks for calling. I'm an automated assistant here to help log your truck accident case. I'll ask a few questions, and you can answer as best you can. First, can you tell me the date of the accident?" }
      ];
      
      conversations.set(callSid, {
        history: conversationHistory,
        phone: req.body.From || 'unknown',
        startTime: new Date().toISOString(),
        data: {}
      });
    }
    
    const currentConversation = conversations.get(callSid);
    const startTime = Date.now();
    
    // OPTIMIZATION: Check if we have a pending response from real-time transcription
    if (currentConversation.pendingResponse) {
      console.log('✅ Using cached response from real-time transcription');
      const gptResponse = currentConversation.pendingResponse;
      delete currentConversation.pendingResponse;
      
      // Check if conversation is complete
      if (gptResponse.includes('CONVERSATION_COMPLETE')) {
        console.log('✅ Conversation complete - saving to Airtable');
        
        if (airtableBase) {
          saveToAirtable(currentConversation).catch(err => {
            console.error('⚠️ Airtable save failed:', err.message);
          });
        }
        
        conversations.delete(callSid);
        
        const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for providing all that information. A qualified truck accident attorney will review your case and contact you within 24 hours. Have a great day!</Say>
  <Hangup/>
</Response>`;
        
        res.type('application/xml');
        res.status(200);
        res.send(texmlResponse);
        return;
      }
      
      // Continue with cached response
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">${sanitizeForSpeech(gptResponse)}</Say>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="30" 
    timeout="3"
    playBeep="false"
    finishOnKey="#"
  />
</Response>`;
      
      res.type('application/xml');
      res.status(200);
      res.send(texmlResponse);
      return;
    }
    
    if (!recordingUrl) {
      console.warn('⚠️ No recording URL provided yet, retrying...');
      // Retry quickly - recording might be processing
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="30" 
    timeout="3"
    playBeep="false"
    finishOnKey="#"
  />
</Response>`;
      
      res.type('application/xml');
      res.status(200);
      res.send(texmlResponse);
      return;
    }
    
    console.log(`🎧 Processing audio (URL: ${recordingUrl})...`);
    
    // OPTIMIZATION: Process transcription and prepare GPT in parallel
    let userInput;
    let transcriptionPromise;
    
    try {
      // Start transcription immediately
      transcriptionPromise = transcribeWithWhisper(recordingUrl);
      
      // While transcription is happening, prepare the conversation context
      // This allows GPT to be ready faster
      userInput = await transcriptionPromise;
      console.log(`✅ User said: "${userInput}" (${Date.now() - startTime}ms)`);
    } catch (transcriptionError) {
      console.error('❌ Transcription failed:', transcriptionError.message);
      // Don't fail completely - use a placeholder and continue
      userInput = "[unclear audio - please repeat]";
    }
    
    // Add user message to history
    currentConversation.history.push({
      role: 'user',
      content: userInput
    });
    
    // Get GPT response - use faster model
    const gptStartTime = Date.now();
    const gptResponse = await getGPTResponse(currentConversation.history);
    console.log(`🤖 GPT said: "${gptResponse}" (${Date.now() - gptStartTime}ms)`);
    console.log(`⏱️ Total processing time: ${Date.now() - startTime}ms`);
    
    // Add assistant message to history
    currentConversation.history.push({
      role: 'assistant',
      content: gptResponse
    });
    
    // Check if conversation is complete
    if (gptResponse.includes('CONVERSATION_COMPLETE')) {
      console.log('✅ Conversation complete - saving to Airtable');
      
      // Don't wait for Airtable save - do it in background
      if (airtableBase) {
        saveToAirtable(currentConversation).catch(err => {
          console.error('⚠️ Airtable save failed:', err.message);
        });
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
      res.status(200);
      res.send(texmlResponse);
      
    } else {
      // Continue conversation - use shorter recordings for speed
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">${sanitizeForSpeech(gptResponse)}</Say>
  <Record 
    action="/process-speech" 
    method="POST" 
    maxLength="30" 
    timeout="3"
    playBeep="false"
    finishOnKey="#"
  />
</Response>`;
      
      console.log('✅ Continuing conversation');
      console.log('========================================');
      
      res.type('application/xml');
      res.status(200);
      res.send(texmlResponse);
    }
    
  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR in /process-speech');
    console.error('========================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('========================================');
    
    try {
      const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm experiencing technical difficulties. Please call back later. Goodbye.</Say>
  <Hangup/>
</Response>`;
      
      res.type('application/xml');
      res.status(200);
      res.send(texmlResponse);
    } catch (sendError) {
      console.error('❌ Failed to send error response:', sendError);
      res.status(500).send('Internal Server Error');
    }
  }
});

// Get response from GPT
async function getGPTResponse(conversationHistory) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    console.log('🤖 Calling GPT API...');
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        // OPTIMIZATION: Use gpt-3.5-turbo for faster responses (2-3x faster than GPT-4)
        // Change back to 'gpt-4' if you need better quality
        // You can also set GPT_MODEL environment variable to override
        model: process.env.GPT_MODEL || 'gpt-3.5-turbo',
        messages: conversationHistory,
        max_tokens: 100, // Reduced for faster responses
        temperature: 0.7,
        // OPTIMIZATION: Stream false for faster single response
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        // OPTIMIZATION: Aggressive timeout - fail fast
        timeout: 10000 // Reduced from 20000
      }
    );
    
    const content = response.data.choices[0].message.content.trim();
    console.log('✅ GPT response received');
    return content;
    
  } catch (error) {
    console.error('❌ GPT error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error('GPT error stack:', error.stack);
    }
    throw error;
  }
}

// Transcribe audio with OpenAI Whisper - OPTIMIZED for speed
async function transcribeWithWhisper(audioUrl) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    console.log(`📥 Downloading audio from: ${audioUrl}`);
    const downloadStart = Date.now();
    
    // OPTIMIZATION: Aggressive timeouts and smaller buffer for speed
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'arraybuffer',
      timeout: 8000, // Very aggressive - fail fast
      maxContentLength: 5 * 1024 * 1024, // 5MB max (smaller files = faster)
      maxBodyLength: 5 * 1024 * 1024,
      // Add compression if supported
      headers: {
        'Accept-Encoding': 'gzip, deflate'
      }
    });
    
    const audioBuffer = Buffer.from(audioResponse.data);
    console.log(`✅ Downloaded ${audioBuffer.length} bytes (${Date.now() - downloadStart}ms)`);
    
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'recording.mp3',
      contentType: 'audio/mpeg'
    });
    // OPTIMIZATION: Use faster model if available, or standard whisper-1
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    // OPTIMIZATION: Add response_format for faster processing
    formData.append('response_format', 'text');
    
    console.log(`🎤 Sending to Whisper API...`);
    const whisperStart = Date.now();
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        },
        // OPTIMIZATION: Aggressive timeout - fail fast if slow
        timeout: 10000 // Very aggressive timeout
      }
    );
    
    const transcriptionTime = Date.now() - whisperStart;
    console.log(`✅ Transcription received (${transcriptionTime}ms)`);
    
    // Handle text response format
    const text = typeof response.data === 'string' ? response.data.trim() : response.data.text.trim();
    return text || '[no speech detected]';
    
  } catch (error) {
    console.error('❌ Whisper error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    // Don't throw - return placeholder so conversation can continue
    return '[transcription error - please repeat]';
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
    if (error.stack) {
      console.error('Airtable error stack:', error.stack);
    }
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
  console.error('========================================');
  console.error('❌ UNHANDLED ERROR MIDDLEWARE');
  console.error('========================================');
  console.error('Error:', err);
  console.error('Error stack:', err.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);
  console.error('========================================');
  
  try {
    res.type('application/xml');
    res.status(200);
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">An error occurred. Goodbye.</Say><Hangup/></Response>');
  } catch (sendError) {
    console.error('❌ Failed to send error response:', sendError);
    res.status(500).send('Internal Server Error');
  }
});

// Start server
const PORT = process.env.PORT || 3000;

// Verify server starts
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 GPT-4 VOICE AGENT STARTED');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📞 Webhook: /texml-webhook`);
  console.log(`🎤 Speech Handler: /process-speech`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`📊 Airtable: ${airtableBase ? '✅' : '⚠️'}`);
  console.log(`🤖 GPT Model: ${process.env.GPT_MODEL || 'gpt-3.5-turbo'}`);
  console.log('========================================');
  console.log('✅ Server is ready to receive requests');
  console.log('========================================');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('========================================');
  console.error('❌ UNCAUGHT EXCEPTION');
  console.error('========================================');
  console.error('Error:', error);
  console.error('Error stack:', error.stack);
  console.error('========================================');
  // Don't exit - let the process continue
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

