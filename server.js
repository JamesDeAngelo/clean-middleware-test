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
  if (!callId) {
    throw new Error("Missing callId for OpenAI connection");
  }

  logger.info(`Connecting to OpenAI WebSocket for call: ${callId}`);

  const ws = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  ws.on('open', async () => {
    try {
      const systemPrompt = await buildSystemPrompt();
      const initPayload = await buildInitialRealtimePayload(systemPrompt);

      ws.send(JSON.stringify(initPayload));
      logger.info(`Initial session.configure payload sent for call: ${callId}`);

      sessionStore.createSession(callId, ws);
      logger.info(`Session stored for call: ${callId}`);
    } catch (err) {
      logger.error(`OpenAI initialization failed for call ${callId}: ${err.message}`);
      ws.close();
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Forward OpenAI audio to Telnyx if available
      if (msg.type === "response.audio.delta" && msg.audio) {
        const session = sessionStore.getSession(callId);
        if (session?.streamConnection) {
          session.streamConnection.send(msg.audio);
          logger.info(`Forwarded audio delta to Telnyx for call: ${callId}`);
        }
      }

      if (msg.type === "response.output_text.delta") {
        logger.info(`OpenAI text delta for call ${callId}: ${msg.text}`);
      }

    } catch (err) {
      logger.error(`Failed to parse OpenAI message for call ${callId}: ${err.message}`);
    }
  });

  ws.on('close', () => {
    logger.info(`OpenAI WebSocket closed for call: ${callId}`);
    sessionStore.deleteSession(callId);
  });

  ws.on('error', (err) => {
    logger.error(`OpenAI WebSocket error for call ${callId}: ${err.message}`);
  });

  return ws;
}

/**
 * Attach Telnyx WS to existing OpenAI session
 */
function attachTelnyxStream(callId, telnyxWs) {
  const session = sessionStore.getSession(callId);

  if (!session) {
    logger.error(`No OpenAI session found for call: ${callId}`);
    return;
  }

  session.streamConnection = telnyxWs;
  logger.info(`Telnyx stream attached for call: ${callId}`);
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);
  if (!session?.ws) return logger.error(`No OpenAI WS for call: ${callId}`);

  sendAudioToOpenAI(session.ws, audioBuffer);
}

function sendAssistantText(callId, text) {
  const session = sessionStore.getSession(callId);
  if (!session?.ws) return logger.error(`No OpenAI WS for call: ${callId}`);

  sendTextToOpenAI(session.ws, text);
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI,
  sendAssistantText
};
