const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
app.use(express.json());

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

// Store active call sessions
const activeCalls = new Map();

// Telnyx webhook handler - receives call control events
app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body.data;
  
  console.log('Telnyx Event:', event.event_type);
  
  try {
    switch (event.event_type) {
      case 'call.initiated':
        await handleCallInitiated(event);
        break;
      
      case 'call.answered':
        await handleCallAnswered(event);
        break;
      
      case 'call.hangup':
        handleCallHangup(event);
        break;
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Handle incoming call
async function handleCallInitiated(event) {
  const callControlId = event.payload.call_control_id;
  const callId = event.payload.call_leg_id;
  
  console.log(`New call initiated: ${callId}`);
  
  // Answer the call
  await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
    {},
    {
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// Handle call answered - start media streaming
async function handleCallAnswered(event) {
  const callControlId = event.payload.call_control_id;
  const callId = event.payload.call_leg_id;
  
  console.log(`Call answered: ${callId}`);
  
  // Start streaming media to our WebSocket server
  const streamUrl = `wss://clean-middleware-test-1.onrender.com/media-stream`;
  
  await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`,
    {
      stream_url: streamUrl,
      stream_track: 'both_tracks', // Get both inbound and outbound audio
      enable_dialogflow: false
    },
    {
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  // Initialize call session
  activeCalls.set(callId, {
    callControlId,
    callId,
    startTime: Date.now(),
    transcript: [],
    leadData: {}
  });
}

// Handle call hangup
function handleCallHangup(event) {
  const callId = event.payload.call_leg_id;
  console.log(`Call ended: ${callId}`);
  
  const session = activeCalls.get(callId);
  if (session) {
    // Save call data to Airtable here
    saveCallToAirtable(session);
    activeCalls.delete(callId);
  }
}

// WebSocket server for media streaming
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (telnyxWs, req) => {
  console.log('Telnyx media stream connected');
  
  let openaiWs = null;
  let callSession = null;
  let streamSid = null;
  
  // Connect to OpenAI Realtime API
  const connectOpenAI = () => {
    openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    openaiWs.on('open', () => {
      console.log('Connected to OpenAI Realtime API');
      
      // Configure the session
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are a helpful AI intake assistant for a personal injury law firm specializing in truck accidents. 
Your job is to:
1. Greet the caller warmly
2. Ask about their truck accident (date, location, injuries)
3. Collect their contact information (name, phone, email)
4. Determine if they need immediate medical attention
5. Let them know a lawyer will contact them within 24 hours

Be empathetic, professional, and efficient. Speak naturally like a real human assistant.`,
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      }));
    });
    
    openaiWs.on('message', (data) => {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'session.created':
          console.log('OpenAI session created');
          break;
        
        case 'response.audio.delta':
          // Send audio back to Telnyx
          if (streamSid && message.delta) {
            telnyxWs.send(JSON.stringify({
              event: 'media',
              stream_sid: streamSid,
              media: {
                payload: message.delta
              }
            }));
          }
          break;
        
        case 'conversation.item.input_audio_transcription.completed':
          // Store caller's transcript
          if (callSession) {
            callSession.transcript.push({
              role: 'user',
              content: message.transcript,
              timestamp: Date.now()
            });
          }
          console.log('User said:', message.transcript);
          break;
        
        case 'response.done':
          // Extract structured data from the conversation
          extractLeadData(message, callSession);
          break;
        
        case 'error':
          console.error('OpenAI error:', message.error);
          break;
      }
    });
    
    openaiWs.on('error', (error) => {
      console.error('OpenAI WebSocket error:', error);
    });
    
    openaiWs.on('close', () => {
      console.log('OpenAI connection closed');
    });
  };
  
  // Handle messages from Telnyx
  telnyxWs.on('message', (data) => {
    const message = JSON.parse(data.toString());
    
    switch (message.event) {
      case 'start':
        streamSid = message.stream_sid;
        const callId = message.call_control_id;
        callSession = activeCalls.get(callId);
        
        console.log('Media stream started:', streamSid);
        
        // Connect to OpenAI
        connectOpenAI();
        break;
      
      case 'media':
        // Forward audio to OpenAI
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: message.media.payload
          }));
        }
        break;
      
      case 'stop':
        console.log('Media stream stopped');
        if (openaiWs) {
          openaiWs.close();
        }
        break;
    }
  });
  
  telnyxWs.on('close', () => {
    console.log('Telnyx connection closed');
    if (openaiWs) {
      openaiWs.close();
    }
  });
  
  telnyxWs.on('error', (error) => {
    console.error('Telnyx WebSocket error:', error);
  });
});

// Extract lead information from conversation
function extractLeadData(response, session) {
  if (!session) return;
  
  // Use OpenAI to extract structured data
  // You can also use function calling here
  const transcript = session.transcript.map(t => t.content).join('\n');
  
  // Simple extraction (you should improve this with better parsing)
  session.leadData = {
    fullTranscript: transcript,
    timestamp: new Date().toISOString(),
    callDuration: (Date.now() - session.startTime) / 1000
  };
}

// Save call data to Airtable
async function saveCallToAirtable(session) {
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
  
  try {
    await axios.post(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        fields: {
          'Call ID': session.callId,
          'Date/Time': new Date(session.startTime).toISOString(),
          'Duration (seconds)': Math.round((Date.now() - session.startTime) / 1000),
          'Transcript': JSON.stringify(session.transcript),
          'Lead Data': JSON.stringify(session.leadData),
          'Qualified': 'Pending' // You can add logic to auto-qualify
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Call saved to Airtable:', session.callId);
  } catch (error) {
    console.error('Error saving to Airtable:', error.response?.data || error.message);
  }
}

// Upgrade HTTP server to handle WebSocket connections
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeCalls: activeCalls.size });
});
