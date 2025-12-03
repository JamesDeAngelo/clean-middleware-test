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

          // Send initial greeting
          setTimeout(() => {
            logger.info(`Sending initial greeting for call: ${callId}`);
            ws.send(JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["text", "audio"],
                instructions: "Greet the caller warmly and introduce yourself as Sarah, the intake assistant. Ask how you can help them today."
              }
            }));
          }, 500);

          resolve(ws);
        } catch (error) {
          logger.error(`Error during OpenAI initialization: ${error.message}`);
          reject(error);
        }
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          const logMsg = msg.type === 'response.audio.delta' 
            ? `[${msg.type}] [audio]` 
            : `[${msg.type}]`;
          logger.info(`OpenAI → ${logMsg}`);

          // AUDIO OUTPUT from OpenAI
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            if (session && session.streamConnection && session.streamConnection.readyState === 1) {
              const telnyxPayload = JSON.stringify({
                event: 'media',
                media: {
                  payload: msg.delta
                }
              });
              
              session.streamConnection.send(telnyxPayload);
              logger.info(`✓ Forwarded audio to caller`);
            } else {
              logger.warn(`⚠ Cannot forward audio: No stream connection`);
            }
          }

          if (msg.type === "response.done") {
            logger.info(`✓ Response completed for call: ${callId}`);
          }

          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            logger.info(`User said: "${msg.transcript}"`);
          }

          if (msg.type === "error") {
            logger.error(`OpenAI error: ${JSON.stringify(msg.error)}`);
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info(`🎤 Speech detected`);
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info(`🔇 Speech ended`);
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
    logger.error(`No session found for call: ${callId}`);
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