const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI
} = require('./openai');

const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

async function connectToOpenAI(callId) {
  return new Promise(async (resolve, reject) => {
    try {
      const ws = new WebSocket(OPENAI_URL, {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      ws.on('open', async () => {
        logger.info('✓ OpenAI connected');
        
        const systemPrompt = await buildSystemPrompt();
        const initPayload = await buildInitialRealtimePayload(systemPrompt);
        
        ws.send(JSON.stringify(initPayload));
        
        sessionStore.createSession(callId, ws);
        
        // Wait for connection to stabilize
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["text", "audio"],
              instructions: "Say: Hi! This is Sarah from the law office. How can I help you today?"
            }
          }));
          logger.info('🎙️ Greeting triggered');
        }, 1500);
        
        resolve(ws);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Handle audio from OpenAI
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            
            if (session?.streamConnection?.readyState === 1) {
              // CRITICAL FIX: Send as base64 with proper event structure
              const audioPayload = {
                event: 'media',
                media: {
                  payload: msg.delta  // Already base64 from OpenAI
                }
              };
              
              session.streamConnection.send(JSON.stringify(audioPayload));
              logger.info(`📤 Sent ${msg.delta.length} chars of audio to Telnyx`);
            } else {
              logger.error(`❌ Cannot send audio - streamConnection not ready`);
            }
          }

          if (msg.type === "response.audio_transcript.delta") {
            logger.info(`🤖 AI: "${msg.delta}"`);
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
          }

          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            logger.info(`👤 User: "${msg.transcript}"`);
          }

          if (msg.type === "response.done") {
            logger.info('✓ Response complete');
          }

          if (msg.type === "error") {
            logger.error(`❌ OpenAI error: ${JSON.stringify(msg.error)}`);
          }

        } catch (err) {
          logger.error(`Parse error: ${err.message}`);
        }
      });

      ws.on('error', (err) => {
        logger.error(`OpenAI error: ${err.message}`);
        reject(err);
      });

      ws.on('close', () => {
        logger.info('OpenAI closed');
      });

    } catch (error) {
      logger.error(`Connect failed: ${error.message}`);
      reject(error);
    }
  });
}

function attachTelnyxStream(callId, telnyxWs) {
  const session = sessionStore.getSession(callId);
  
  if (!session) {
    logger.error(`No session for: ${callId}`);
    return;
  }
  
  session.streamConnection = telnyxWs;
  sessionStore.updateSession(callId, session);
  logger.info('✓ Stream attached');
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);
  
  if (session?.ws) {
    sendAudioToOpenAI(session.ws, audioBuffer);
  }
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI
};