const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const Airtable = require('airtable');

const app = express();

// Middleware
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Airtable
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  airtableBase = new Airtable({apiKey: process.env.AIRTABLE_API_KEY})
    .base(process.env.AIRTABLE_BASE_ID);
}

// Store active calls
const activeCalls = new Map();

// System instructions for OpenAI Realtime
const SYSTEM_INSTRUCTIONS = `You are an AI legal intake assistant for truck accident cases. Your job is to collect information from callers naturally and efficiently.

Ask these questions in order, but adapt based on what they say:
1. Date of the accident
2. Location (city, state, road)
3. Description of what happened
4. Were there injuries?
5. Their full name
6. Their phone number

RULES:
- Keep responses SHORT (1-2 sentences)
- Be conversational and natural
- If they provide info out of order, acknowledge it and skip that question
- Always confirm important details
- Be empathetic

When you have all 6 pieces of information, say: "Thank you! An attorney will contact you within 24 hours." Then end the call.`;

// Health check
app.get('/', (req, res) => {
  res.send('🚀 OpenAI Realtime Voice Agent Running!');
});

// Telnyx webhook - initiate call with Call Control API
app.post('/telnyx-webhook', async (req, res) => {
  try {
    const event = req.body.data;
    const eventType = event?.event_type || req.body.event_type;
    
    console.log(`📞 Telnyx event: ${eventType}`);
    
    if (eventType === 'call.initiated' || eventType === 'call.answered') {
      const callControlId = event.call_control_id;
      const callSid = event.call_session_id;
      const from = event.from;
      
      console.log(`✅ New call: ${callSid} from ${from}`);
      
      // Answer the call
      await answerCall(callControlId);
      
      // Start media streaming
      await startMediaStream(callControlId, callSid);
      
      res.status(200).send('OK');
      
    } else if (eventType === 'call.hangup') {
      const callSid = event.call_session_id;
      console.log(`👋 Call ended: ${callSid}`);
      
      // Clean up
      const callData = activeCalls.get(callSid);
      if (callData) {
        if (callData.openaiWs) callData.openaiWs.close();
        if (callData.telnyxWs) callData.telnyxWs.close();
        
        // Save to Airtable
        if (airtableBase && callData.transcript) {
          await saveToAirtable(callData);
        }
        
        activeCalls.delete(callSid);
      }
      
      res.status(200).send('OK');
      
    } else {
      res.status(200).send('OK');
    }
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(200).send('OK');
  }
});

// WebSocket server for Telnyx media streams
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (telnyxWs, req) => {
  const callSid = req.url.split('/').pop();
  console.log(`🔌 Telnyx WebSocket connected for call: ${callSid}`);
  
  // Initialize call data
  const callData = {
    callSid,
    telnyxWs,
    openaiWs: null,
    transcript: '',
    startTime: new Date().toISOString(),
    phone: null
  };
  
  activeCalls.set(callSid, callData);
  
  // Connect to OpenAI Realtime API
  connectToOpenAI(callData);
  
  // Handle incoming audio from Telnyx
  telnyxWs.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'media' && callData.openaiWs?.readyState === WebSocket.OPEN) {
        // Forward audio to OpenAI (base64 encoded)
        callData.openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: data.media.payload
        }));
      }
      
      if (data.event === 'start') {
        console.log(`🎤 Media stream started for ${callSid}`);
        callData.phone = data.start.customParameters?.from || 'unknown';
      }
      
    } catch (error) {
      console.error('❌ Telnyx message error:', error.message);
    }
  });
  
  telnyxWs.on('close', () => {
    console.log(`🔌 Telnyx WebSocket closed for ${callSid}`);
    if (callData.openaiWs) {
      callData.openaiWs.close();
    }
  });
});

// Connect to OpenAI Realtime API
function connectToOpenAI(callData) {
  const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  
  const openaiWs = new WebSocket(url, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });
  
  callData.openaiWs = openaiWs;
  
  openaiWs.on('open', () => {
    console.log(`🤖 OpenAI Realtime connected for ${callData.callSid}`);
    
    // Configure session
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: SYSTEM_INSTRUCTIONS,
        voice: 'alloy', // Options: alloy, echo, shimmer
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    }));
    
    // Start conversation
    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: "Hi! Thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?"
        }]
      }
    }));
    
    openaiWs.send(JSON.stringify({ type: 'response.create' }));
  });
  
  openaiWs.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle audio output from OpenAI
      if (data.type === 'response.audio.delta' && data.delta) {
        // Forward audio to Telnyx
        if (callData.telnyxWs?.readyState === WebSocket.OPEN) {
          callData.telnyxWs.send(JSON.stringify({
            event: 'media',
            media: {
              payload: data.delta
            }
          }));
        }
      }
      
      // Log transcript
      if (data.type === 'conversation.item.created') {
        const item = data.item;
        if (item.role === 'user' && item.content) {
          const text = item.content[0]?.transcript || item.content[0]?.text;
          if (text) {
            console.log(`👤 User: ${text}`);
            callData.transcript += `User: ${text}\n`;
          }
        }
        if (item.role === 'assistant' && item.content) {
          const text = item.content[0]?.transcript || item.content[0]?.text;
          if (text) {
            console.log(`🤖 Assistant: ${text}`);
            callData.transcript += `Assistant: ${text}\n`;
          }
        }
      }
      
      // Check if conversation is complete
      if (data.type === 'response.done') {
        const text = data.response?.output?.[0]?.content?.[0]?.transcript || '';
        if (text.toLowerCase().includes('attorney will contact you')) {
          console.log('✅ Conversation complete');
          setTimeout(() => {
            // Hang up call
            if (callData.telnyxWs?.readyState === WebSocket.OPEN) {
              callData.telnyxWs.close();
            }
          }, 2000);
        }
      }
      
    } catch (error) {
      console.error('❌ OpenAI message error:', error.message);
    }
  });
  
  openaiWs.on('error', (error) => {
    console.error('❌ OpenAI WebSocket error:', error.message);
  });
  
  openaiWs.on('close', () => {
    console.log(`🤖 OpenAI WebSocket closed for ${callData.callSid}`);
  });
}

// Answer call via Telnyx Call Control API
async function answerCall(callControlId) {
  try {
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
    console.log('✅ Call answered');
  } catch (error) {
    console.error('❌ Answer call error:', error.response?.data || error.message);
  }
}

// Start media streaming
async function startMediaStream(callControlId, callSid) {
  try {
    const streamUrl = `wss://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-app.onrender.com'}/media/${callSid}`;
    
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`,
      {
        stream_url: streamUrl,
        stream_track: 'both'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Media streaming started');
  } catch (error) {
    console.error('❌ Start streaming error:', error.response?.data || error.message);
  }
}

// Save to Airtable
async function saveToAirtable(callData) {
  try {
    await airtableBase('Leads').create({
      "Phone Number": callData.phone,
      "Call Start": callData.startTime,
      "Full Transcript": callData.transcript,
      "Status": "New",
      "Qualified": "Yes"
    });
    console.log('✅ Saved to Airtable');
  } catch (error) {
    console.error('❌ Airtable error:', error.message);
  }
}

// Start HTTP server
const server = app.listen(process.env.PORT || 3000, () => {
  console.log('========================================');
  console.log('🚀 OPENAI REALTIME VOICE AGENT STARTED');
  console.log('========================================');
  console.log(`📡 Port: ${process.env.PORT || 3000}`);
  console.log(`🔑 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`📞 Telnyx: ${process.env.TELNYX_API_KEY ? '✅' : '❌'}`);
  console.log(`📊 Airtable: ${airtableBase ? '✅' : '⚠️'}`);
  console.log('========================================');
});

// Upgrade HTTP server to handle WebSocket
server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/media/')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});
