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
          logger.info(`Received message from OpenAI: ${JSON.stringify(msg)}`);

          // AUDIO OUTPUT from OpenAI
          if (msg.type === "response.audio.delta" && msg.audio) {
            const session = sessionStore.getSession(callId);
            if (session && session.streamConnection) {
              // Forward OpenAI audio → Telnyx media stream
              session.streamConnection.send(msg.audio);
              logger.info(`Forwarded audio delta to Telnyx for call: ${callId}`);
            }
          }

          // TEXT OUTPUT from OpenAI (not required but good for logs)
          if (msg.type === "response.output_text.delta") {
            logger.info(`OpenAI text: ${msg.text}`);
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
  sessionStore.createSession(callId, session.ws);
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
