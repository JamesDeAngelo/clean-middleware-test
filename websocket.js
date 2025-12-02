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
        logger.info(`OpenAI WebSocket opened for call: ${callId}`);

        try {
          // Build prompt + session configuration
          const systemPrompt = await buildSystemPrompt();
          const initPayload = await buildInitialRealtimePayload(systemPrompt);

          // Send session.configure payload
          ws.send(JSON.stringify(initPayload));
          logger.info(`Initial session.configure payload sent for call: ${callId}`);

          // Create session in memory
          sessionStore.createSession(callId, ws);
          logger.info(`Session stored for call: ${callId}`);

          resolve(ws);
        } catch (error) {
          logger.error(`Error during OpenAI initialization for ${callId}: ${error.message}`);
          reject(error);
        }
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          logger.info(`Received from OpenAI [${msg.type}]: ${msg.type === 'response.audio.delta' ? '[audio data]' : JSON.stringify(msg).substring(0, 200)}`);

          // AUDIO OUTPUT from OpenAI
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            if (session && session.streamConnection) {
              // FIXED: Use msg.delta instead of msg.audio
              // Forward OpenAI audio → Telnyx media stream
              const telnyxPayload = JSON.stringify({
                event: 'media',
                media: {
                  payload: msg.delta
                }
              });
              
              session.streamConnection.send(telnyxPayload);
              logger.info(`Forwarded audio delta to Telnyx for call: ${callId}`);
            } else {
              logger.warn(`Cannot forward audio: No stream connection for call ${callId}`);
            }
          }

          // TEXT OUTPUT from OpenAI (for logging)
          if (msg.type === "response.text.delta" || msg.type === "response.output_text.delta") {
            logger.info(`OpenAI text: ${msg.delta || msg.text}`);
          }

          // Handle errors from OpenAI
          if (msg.type === "error") {
            logger.error(`OpenAI error: ${JSON.stringify(msg.error)}`);
          }
        } catch (err) {
          logger.error(`Failed to parse OpenAI message: ${err.message}`);
        }
      });

      ws.on('close', () => {
        logger.info(`OpenAI WebSocket closed for call: ${callId}`);
      });

      ws.on('error', (err) => {
        logger.error(`OpenAI WebSocket error for ${callId}: ${err.message}`);
        reject(err);
      });
    } catch (error) {
      logger.error(`Failed to connect to OpenAI: ${error.message}`);
      reject(error);
    }
  });
}

/**
 * This is called by mediaStream.js when Telnyx connects.
 * It attaches the Telnyx WebSocket to the session so you can forward AI audio.
 */
function attachTelnyxStream(callId, telnyxWs) {
  const session = sessionStore.getSession(callId);

  if (!session) {
    logger.error(`No OpenAI session found for call: ${callId}`);
    return;
  }

  logger.info(`Attaching Telnyx stream socket to session for call: ${callId}`);

  session.streamConnection = telnyxWs;
  // FIXED: Update the session properly
  sessionStore.updateSession(callId, session);
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);

  if (!session || !session.ws) {
    logger.error(`No session or WS found for call: ${callId}, cannot send audio.`);
    return;
  }

  sendAudioToOpenAI(session.ws, audioBuffer);
}

function sendAssistantText(callId, text) {
  const session = sessionStore.getSession(callId);

  if (!session || !session.ws) {
    logger.error(`No session found for call: ${callId}, cannot send assistant text.`);
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