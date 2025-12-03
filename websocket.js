const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI,
  sendTextToOpenAI
} = require('./openai');

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

async function connectToOpenAI(callId) {
  return new Promise(async (resolve, reject) => {
    try {
      logger.info(`Connecting to OpenAI WebSocket for call: ${callId}`);

      const ws = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      ws.on('open', async () => {
        logger.info(`✓ OpenAI WebSocket opened for call: ${callId}`);

        try {
          const systemPrompt = await buildSystemPrompt();
          const initPayload = await buildInitialRealtimePayload(systemPrompt);

          ws.send(JSON.stringify(initPayload));
          logger.info(`✓ Session configuration sent for call: ${callId}`);

          sessionStore.createSession(callId, ws);
          logger.info(`✓ Session stored for call: ${callId}`);

          // Send initial greeting after stream is attached
          setTimeout(() => {
            logger.info(`Triggering initial greeting for call: ${callId}`);
            ws.send(JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["text", "audio"],
                instructions: "Greet the caller warmly and introduce yourself as Sarah from the law office. Ask how you can help them today."
              }
            }));
          }, 1000);

          resolve(ws);
        } catch (error) {
          logger.error(`Error during OpenAI initialization: ${error.message}`);
          reject(error);
        }
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // AUDIO OUTPUT from OpenAI - CRITICAL FIX
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            if (session && session.streamConnection && session.streamConnection.readyState === 1) {
              // Send audio in Telnyx's expected format
              // The delta is already base64-encoded PCM16 from OpenAI
              const telnyxPayload = JSON.stringify({
                event: 'media',
                media: {
                  payload: msg.delta  // Already base64 encoded
                }
              });
              
              session.streamConnection.send(telnyxPayload);
              logger.info(`✓ Audio sent to Telnyx`);
            } else {
              logger.warn(`⚠ Cannot send audio: Stream not ready`);
            }
          }

          // Log response completion
          if (msg.type === "response.done") {
            logger.info(`✓ Response completed`);
          }

          // Log user speech detection
          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info(`🎤 User started speaking`);
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info(`🔇 User stopped speaking`);
          }

          // Log transcriptions
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            logger.info(`📝 User said: "${msg.transcript}"`);
          }

          // Log any errors
          if (msg.type === "error") {
            logger.error(`❌ OpenAI error: ${JSON.stringify(msg.error)}`);
          }

        } catch (err) {
          logger.error(`Failed to parse OpenAI message: ${err.message}`);
        }
      });

      ws.on('close', () => {
        logger.info(`OpenAI WebSocket closed for call: ${callId}`);
      });

      ws.on('error', (err) => {
        logger.error(`OpenAI WebSocket error: ${err.message}`);
        reject(err);
      });
    } catch (error) {
      logger.error(`Failed to connect to OpenAI: ${error.message}`);
      reject(error);
    }
  });
}

function attachTelnyxStream(callId, telnyxWs) {
  const session = sessionStore.getSession(callId);

  if (!session) {
    logger.error(`No OpenAI session found for call: ${callId}`);
    return;
  }

  logger.info(`✓ Attaching Telnyx stream to session`);

  session.streamConnection = telnyxWs;
  sessionStore.updateSession(callId, session);
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);

  if (!session || !session.ws) {
    return;
  }

  sendAudioToOpenAI(session.ws, audioBuffer);
}

function sendAssistantText(callId, text) {
  const session = sessionStore.getSession(callId);

  if (!session || !session.ws) {
    logger.error(`No session found for call: ${callId}`);
    return;
  }

  sendTextToOpenAI(session.ws, text);
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI,
  sendAssistantText
};