// ============================================================================
// FILE: server/index.js
// Production-Ready Real-Time Voice Agent with Telnyx + OpenAI Realtime
// ============================================================================

import express from 'express';
import { WebSocketServer } from 'ws';
import axios from 'axios';
import { Transform } from 'stream';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

// ============================================================================
// CONFIGURATION & VALIDATION
// ============================================================================

const requiredEnvVars = [
  'TELNYX_API_KEY',
  'OPENAI_API_KEY',
  'PORT'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

const config = {
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY,
    apiUrl: 'https://api.telnyx.com/v2',
    number: process.env.TELNYX_NUMBER || ''
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    realtimeUrl: process.env.OPENAI_REALTIME_URL || 'wss://api.openai.com/v1/realtime',
    model: 'gpt-4o-realtime-preview-2024-12-17'
  },
  server: {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    tableName: process.env.AIRTABLE_TABLE_NAME || 'Calls'
  },
  audio: {
    sampleRate: 24000, // OpenAI Realtime uses 24kHz
    channels: 1
  },
  performance: {
    targetLatencyMs: 2000,
    llmTimeoutMs: 1500
  },
  features: {
    useRealtime: process.env.USE_REALTIME !== 'false'
  }
};

// ============================================================================
// LOGGING & METRICS
// ============================================================================

const logger = pino({
  level: config.server.nodeEnv === 'production' ? 'info' : 'debug',
  transport: config.server.nodeEnv !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined
});

class PerformanceMetrics {
  constructor() {
    this.metrics = {
      totalCalls: 0,
      activeCalls: 0,
      completedCalls: 0,
      failedCalls: 0,
      avgLatency: {
        audioToTranscript: [],
        transcriptToLLM: [],
        llmToTTS: [],
        fullResponse: []
      }
    };
  }

  recordLatency(type, ms) {
    if (this.metrics.avgLatency[type]) {
      this.metrics.avgLatency[type].push(ms);
      // Keep only last 100 measurements
      if (this.metrics.avgLatency[type].length > 100) {
        this.metrics.avgLatency[type].shift();
      }
    }
  }

  getAverage(type) {
    const arr = this.metrics.avgLatency[type];
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  incrementCalls() { this.metrics.totalCalls++; this.metrics.activeCalls++; }
  decrementActiveCalls() { this.metrics.activeCalls--; }
  incrementCompleted() { this.metrics.completedCalls++; }
  incrementFailed() { this.metrics.failedCalls++; }

  getMetrics() {
    return {
      ...this.metrics,
      avgLatency: {
        audioToTranscript: this.getAverage('audioToTranscript').toFixed(0),
        transcriptToLLM: this.getAverage('transcriptToLLM').toFixed(0),
        llmToTTS: this.getAverage('llmToTTS').toFixed(0),
        fullResponse: this.getAverage('fullResponse').toFixed(0)
      }
    };
  }
}

const metrics = new PerformanceMetrics();

// ============================================================================
// CONVERSATION STATE MACHINE (8-Step Intake Flow)
// ============================================================================

class ConversationStateMachine {
  constructor(callId) {
    this.callId = callId;
    this.currentStep = 0;
    this.collectedData = {};
    this.conversationHistory = [];
    
    this.steps = [
      {
        id: 'greeting',
        prompt: 'Hello! Thank you for calling. I\'m here to help you with your truck accident case. Can you tell me your name?',
        dataKey: 'callerName',
        validator: (text) => text && text.length > 1
      },
      {
        id: 'accident_date',
        prompt: 'Thank you, {callerName}. When did the truck accident occur? Please provide the date.',
        dataKey: 'accidentDate',
        validator: (text) => text && text.length > 3
      },
      {
        id: 'accident_location',
        prompt: 'Where did the accident happen? Please tell me the city and state.',
        dataKey: 'location',
        validator: (text) => text && text.length > 3
      },
      {
        id: 'injuries',
        prompt: 'Were you or anyone else injured? Please describe any injuries.',
        dataKey: 'injuries',
        validator: (text) => text && text.length > 2
      },
      {
        id: 'phone',
        prompt: 'What\'s the best phone number to reach you?',
        dataKey: 'phone',
        validator: (text) => /\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(text)
      },
      {
        id: 'email',
        prompt: 'And your email address?',
        dataKey: 'email',
        validator: (text) => /\S+@\S+\.\S+/.test(text)
      },
      {
        id: 'medical_attention',
        prompt: 'Did you receive medical attention? If not, do you need immediate medical care right now?',
        dataKey: 'medicalAttention',
        validator: (text) => text && text.length > 1
      },
      {
        id: 'closing',
        prompt: 'Thank you for providing all that information, {callerName}. An experienced attorney will contact you within 24 hours to discuss your case. Is there anything else you\'d like me to know?',
        dataKey: 'additionalNotes',
        validator: () => true
      }
    ];
  }

  getCurrentPrompt() {
    if (this.currentStep >= this.steps.length) return null;
    
    const step = this.steps[this.currentStep];
    let prompt = step.prompt;
    
    // Replace placeholders with collected data
    Object.keys(this.collectedData).forEach(key => {
      prompt = prompt.replace(`{${key}}`, this.collectedData[key]);
    });
    
    return prompt;
  }

  processResponse(transcript) {
    if (this.currentStep >= this.steps.length) return { complete: true };
    
    const step = this.steps[this.currentStep];
    
    // Store the response
    this.collectedData[step.dataKey] = transcript;
    this.conversationHistory.push({
      step: step.id,
      question: this.getCurrentPrompt(),
      answer: transcript,
      timestamp: Date.now()
    });
    
    // Validate and move to next step
    if (step.validator(transcript)) {
      this.currentStep++;
      
      if (this.currentStep >= this.steps.length) {
        return { 
          complete: true, 
          data: this.collectedData,
          history: this.conversationHistory
        };
      }
      
      return { 
        complete: false, 
        nextPrompt: this.getCurrentPrompt() 
      };
    }
    
    return { 
      complete: false, 
      error: 'Invalid response, please try again.',
      retry: true 
    };
  }

  isComplete() {
    return this.currentStep >= this.steps.length;
  }
}

// ============================================================================
// CALL SESSION MANAGER
// ============================================================================

class CallSession {
  constructor(callControlId, callId) {
    this.callControlId = callControlId;
    this.callId = callId;
    this.startTime = Date.now();
    this.stateMachine = new ConversationStateMachine(callId);
    this.openaiWs = null;
    this.telnyxWs = null;
    this.streamSid = null;
    this.audioBuffer = [];
    this.latencyTracking = {};
    this.isProcessing = false;
    
    logger.info({ callId }, 'New call session created');
    metrics.incrementCalls();
  }

  trackLatency(event) {
    this.latencyTracking[event] = Date.now();
  }

  calculateLatency(startEvent, endEvent) {
    if (this.latencyTracking[startEvent] && this.latencyTracking[endEvent]) {
      return this.latencyTracking[endEvent] - this.latencyTracking[startEvent];
    }
    return 0;
  }

  async cleanup() {
    logger.info({ callId: this.callId }, 'Cleaning up call session');
    
    if (this.openaiWs) {
      this.openaiWs.close();
    }
    
    metrics.decrementActiveCalls();
    
    // Save to Airtable
    await this.saveToAirtable();
  }

  async saveToAirtable() {
    if (!config.airtable.apiKey || !config.airtable.baseId) {
      logger.warn('Airtable not configured, skipping save');
      return;
    }

    try {
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      const data = this.stateMachine.collectedData;
      
      await axios.post(
        `https://api.airtable.com/v0/${config.airtable.baseId}/${config.airtable.tableName}`,
        {
          fields: {
            'Call ID': this.callId,
            'Date/Time': new Date(this.startTime).toISOString(),
            'Duration (seconds)': duration,
            'Caller Name': data.callerName || 'Unknown',
            'Phone': data.phone || '',
            'Email': data.email || '',
            'Accident Date': data.accidentDate || '',
            'Location': data.location || '',
            'Injuries': data.injuries || '',
            'Medical Attention': data.medicalAttention || '',
            'Additional Notes': data.additionalNotes || '',
            'Qualified': data.injuries && data.injuries.toLowerCase() !== 'no' ? 'Yes' : 'Pending',
            'Conversation History': JSON.stringify(this.stateMachine.conversationHistory),
            'Latency Metrics': JSON.stringify({
              audioToTranscript: this.calculateLatency('audioReceived', 'transcriptReceived'),
              transcriptToLLM: this.calculateLatency('transcriptReceived', 'llmStarted'),
              llmToTTS: this.calculateLatency('llmStarted', 'ttsStarted'),
              fullResponse: this.calculateLatency('audioReceived', 'ttsStarted')
            })
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${config.airtable.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info({ callId: this.callId }, 'Call data saved to Airtable');
      metrics.incrementCompleted();
    } catch (error) {
      logger.error({ error: error.message, callId: this.callId }, 'Error saving to Airtable');
      metrics.incrementFailed();
    }
  }
}

const activeSessions = new Map();

// ============================================================================
// OPENAI REALTIME CONNECTION HANDLER
// ============================================================================

async function setupOpenAIConnection(session) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${config.openai.realtimeUrl}?model=${config.openai.model}`;
    
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    ws.on('open', () => {
      logger.info({ callId: session.callId }, 'OpenAI Realtime connection established');
      
      // Configure session
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are a professional, empathetic AI intake assistant for a personal injury law firm specializing in truck accidents.

Your personality:
- Warm, friendly, and professional
- Patient and understanding with callers who may be stressed
- Clear and concise in your communication
- Empathetic to their situation

Current conversation state: You will be guided by the system to ask specific questions in order. Listen carefully to the caller's response and then wait for the system to provide the next question to ask.

Keep responses natural and conversational. If the caller provides extra information, acknowledge it warmly before moving to the next question.`,
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
          },
          temperature: 0.7,
          max_response_output_tokens: 150
        }
      }));

      // Send initial greeting
      const initialPrompt = session.stateMachine.getCurrentPrompt();
      if (initialPrompt) {
        ws.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: `Say this to the caller: "${initialPrompt}"`
          }
        }));
      }

      resolve(ws);
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleOpenAIMessage(session, message);
      } catch (error) {
        logger.error({ error: error.message, callId: session.callId }, 'Error processing OpenAI message');
      }
    });

    ws.on('error', (error) => {
      logger.error({ error: error.message, callId: session.callId }, 'OpenAI WebSocket error');
      reject(error);
    });

    ws.on('close', () => {
      logger.info({ callId: session.callId }, 'OpenAI connection closed');
    });

    session.openaiWs = ws;
  });
}

async function handleOpenAIMessage(session, message) {
  switch (message.type) {
    case 'session.created':
    case 'session.updated':
      logger.debug({ callId: session.callId }, `OpenAI ${message.type}`);
      break;

    case 'input_audio_buffer.speech_started':
      logger.debug({ callId: session.callId }, 'Caller started speaking');
      session.trackLatency('audioReceived');
      break;

    case 'input_audio_buffer.speech_stopped':
      logger.debug({ callId: session.callId }, 'Caller stopped speaking');
      break;

    case 'conversation.item.input_audio_transcription.completed':
      session.trackLatency('transcriptReceived');
      const transcript = message.transcript;
      logger.info({ callId: session.callId, transcript }, 'Transcription received');
      
      const latency = session.calculateLatency('audioReceived', 'transcriptReceived');
      metrics.recordLatency('audioToTranscript', latency);
      
      // Process through state machine
      session.trackLatency('llmStarted');
      const result = session.stateMachine.processResponse(transcript);
      
      if (result.complete) {
        logger.info({ callId: session.callId }, 'Conversation complete');
        
        // Send closing message
        session.openaiWs.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: 'Say: "Thank you so much for your time. An attorney will be in touch with you soon. Take care and have a great day. Goodbye!"'
          }
        }));
        
        // Schedule hangup after response
        setTimeout(async () => {
          await hangupCall(session.callControlId);
        }, 5000);
        
      } else if (result.error) {
        // Ask again
        session.openaiWs.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: `Say: "I'm sorry, I didn't quite catch that. ${result.error} ${session.stateMachine.getCurrentPrompt()}"`
          }
        }));
      } else if (result.nextPrompt) {
        // Move to next question
        session.openaiWs.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: `Say: "${result.nextPrompt}"`
          }
        }));
      }
      break;

    case 'response.audio.delta':
      // Stream audio back to Telnyx
      if (session.telnyxWs && session.streamSid && message.delta) {
        if (!session.trackLatency('ttsStarted')) {
          session.trackLatency('ttsStarted');
          
          const fullLatency = session.calculateLatency('audioReceived', 'ttsStarted');
          metrics.recordLatency('fullResponse', fullLatency);
          
          logger.info({ 
            callId: session.callId, 
            latencyMs: fullLatency 
          }, 'Full response latency');
        }
        
        session.telnyxWs.send(JSON.stringify({
          event: 'media',
          stream_sid: session.streamSid,
          media: {
            payload: message.delta
          }
        }));
      }
      break;

    case 'response.audio.done':
      logger.debug({ callId: session.callId }, 'Audio response complete');
      break;

    case 'error':
      logger.error({ 
        error: message.error, 
        callId: session.callId 
      }, 'OpenAI error');
      break;

    default:
      logger.debug({ type: message.type, callId: session.callId }, 'OpenAI message');
  }
}

// ============================================================================
// TELNYX CALL CONTROL HANDLERS
// ============================================================================

async function handleCallInitiated(event) {
  const callControlId = event.payload.call_control_id;
  const callId = event.payload.call_leg_id;
  const from = event.payload.from;
  
  logger.info({ callId, from }, 'Incoming call');
  
  try {
    // Answer the call
    await axios.post(
      `${config.telnyx.apiUrl}/calls/${callControlId}/actions/answer`,
      {
        client_state: Buffer.from(JSON.stringify({ callId })).toString('base64')
      },
      {
        headers: {
          'Authorization': `Bearer ${config.telnyx.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info({ callId }, 'Call answered');
  } catch (error) {
    logger.error({ error: error.message, callId }, 'Error answering call');
  }
}

async function handleCallAnswered(event) {
  const callControlId = event.payload.call_control_id;
  const callId = event.payload.call_leg_id;
  
  logger.info({ callId }, 'Call answered event received');
  
  try {
    // Create session
    const session = new CallSession(callControlId, callId);
    activeSessions.set(callId, session);
    
    // Start media streaming
    const streamUrl = `wss://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'}/media-stream`;
    
    await axios.post(
      `${config.telnyx.apiUrl}/calls/${callControlId}/actions/streaming_start`,
      {
        stream_url: streamUrl,
        stream_track: 'inbound_track',
        client_state: Buffer.from(JSON.stringify({ callId })).toString('base64')
      },
      {
        headers: {
          'Authorization': `Bearer ${config.telnyx.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info({ callId, streamUrl }, 'Media streaming started');
  } catch (error) {
    logger.error({ error: error.message, callId }, 'Error starting media stream');
  }
}

async function handleCallHangup(event) {
  const callId = event.payload.call_leg_id;
  logger.info({ callId }, 'Call hangup');
  
  const session = activeSessions.get(callId);
  if (session) {
    await session.cleanup();
    activeSessions.delete(callId);
  }
}

async function hangupCall(callControlId) {
  try {
    await axios.post(
      `${config.telnyx.apiUrl}/calls/${callControlId}/actions/hangup`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${config.telnyx.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    logger.info({ callControlId }, 'Call hung up');
  } catch (error) {
    logger.error({ error: error.message, callControlId }, 'Error hanging up call');
  }
}

// ============================================================================
// EXPRESS APP & WEBHOOK ENDPOINTS
// ============================================================================

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeCalls: activeSessions.size,
    timestamp: new Date().toISOString()
  });
});

// Metrics endpoint (Prometheus-compatible)
app.get('/metrics', (req, res) => {
  const metricsData = metrics.getMetrics();
  
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP voice_agent_calls_total Total number of calls
# TYPE voice_agent_calls_total counter
voice_agent_calls_total ${metricsData.totalCalls}

# HELP voice_agent_calls_active Active calls
# TYPE voice_agent_calls_active gauge
voice_agent_calls_active ${metricsData.activeCalls}

# HELP voice_agent_calls_completed Completed calls
# TYPE voice_agent_calls_completed counter
voice_agent_calls_completed ${metricsData.completedCalls}

# HELP voice_agent_calls_failed Failed calls
# TYPE voice_agent_calls_failed counter
voice_agent_calls_failed ${metricsData.failedCalls}

# HELP voice_agent_latency_audio_to_transcript_ms Average latency from audio to transcript (ms)
# TYPE voice_agent_latency_audio_to_transcript_ms gauge
voice_agent_latency_audio_to_transcript_ms ${metricsData.avgLatency.audioToTranscript}

# HELP voice_agent_latency_full_response_ms Average full response latency (ms)
# TYPE voice_agent_latency_full_response_ms gauge
voice_agent_latency_full_response_ms ${metricsData.avgLatency.fullResponse}
  `.trim());
});

// Telnyx webhook handler
app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body.data;
  
  logger.debug({ eventType: event.event_type }, 'Telnyx webhook received');
  
  try {
    switch (event.event_type) {
      case 'call.initiated':
        await handleCallInitiated(event);
        break;
      
      case 'call.answered':
        await handleCallAnswered(event);
        break;
      
      case 'call.hangup':
        await handleCallHangup(event);
        break;
      
      default:
        logger.debug({ eventType: event.event_type }, 'Unhandled event type');
    }
    
    res.sendStatus(200);
  } catch (error) {
    logger.error({ error: error.message }, 'Webhook handler error');
    res.sendStatus(500);
  }
});

// ============================================================================
// WEBSOCKET SERVER FOR MEDIA STREAMS
// ============================================================================

const server = app.listen(config.server.port, () => {
  logger.info({ port: config.server.port }, 'Server started');
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', async (telnyxWs, req) => {
  logger.info('Telnyx media stream connected');
  
  let session = null;
  
  telnyxWs.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.event) {
        case 'start':
          const streamSid = message.stream_sid;
          const callId = message.call_control_id || message.call_leg_id;
          
          logger.info({ streamSid, callId }, 'Media stream started');
          
          // Find or create session
          session = activeSessions.get(callId);
          if (session) {
            session.telnyxWs = telnyxWs;
            session.streamSid = streamSid;
            
            // Setup OpenAI connection
            await setupOpenAIConnection(session);
          }
          break;
        
        case 'media':
          if (session && session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
            // Forward audio to OpenAI
            session.openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: message.media.payload
            }));
          }
          break;
        
        case 'stop':
          logger.info('Media stream stopped');
          break;
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Media stream error');
    }
  });
  
  telnyxWs.on('close', () => {
    logger.info('Telnyx media connection closed');
  });
  
  telnyxWs.on('error', (error) => {
    logger.error({ error: error.message }, 'Telnyx WebSocket error');
  });
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Close all active sessions
  for (const [callId, session] of activeSessions) {
    await session.cleanup();
  }
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

logger.info({ config: { ...config, telnyx: { apiKey: '[REDACTED]' }, openai: { apiKey: '[REDACTED]' } } }, 'Configuration loaded');
