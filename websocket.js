const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { buildSystemPrompt, buildInitialRealtimePayload } = require('./openai');
const axios = require('axios');

async function connectToOpenAI(callId) {
  if (!callId) {
    logger.error('Missing callId for OpenAI connection');
    return null;
  }
  const ws = new WebSocket(process.env.OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    }
  });
  ws.on('open', async () => {
    logger.info('OpenAI WebSocket connected');
    sessionStore.createSession(callId, ws);
    try {
      const systemPrompt = await buildSystemPrompt();
      const initPayload = await buildInitialRealtimePayload(systemPrompt);
      ws.send(JSON.stringify(initPayload));
    } catch (error) {
      logger.error(`Failed to send initial payload: ${error.message}`);
    }
  });
  ws.on('message', async (data) => {
    logger.info(`Received message: ${data}`);
    try {
      const message = JSON.parse(data);
      if (message.type === 'output_audio_buffer.delta' && message.audio) {
        await sendAudioToTelnyx(callId, message.audio);
      }
    } catch (error) {
      logger.error(`Failed to process OpenAI message: ${error.message}`);
    }
  });
  ws.on('error', (error) => {
    logger.error(`WebSocket error: ${error.message}`);
  });
  ws.on('close', () => {
    logger.info('OpenAI WebSocket closed');
    sessionStore.deleteSession(callId);
  });
  return ws;
}

async function sendAudioToOpenAI(callId, audioChunk) {
  try {
    const session = sessionStore.getSession(callId);
    if (!session || !session.ws) {
      logger.error(`No active WebSocket for callId: ${callId}`);
      return;
    }
    const payload = {
      type: 'input_audio_buffer.append',
      audio: audioChunk
    };
    session.ws.send(JSON.stringify(payload));
  } catch (error) {
    logger.error(`Failed to send audio to OpenAI: ${error.message}`);
  }
}

async function sendAudioToTelnyx(callId, audioChunk) {
  try {
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callId}/stream`,
      {
        audio_data: audioChunk,
        audio_format: 'pcm16'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    logger.error(`Failed to send audio to Telnyx: ${error.message}`);
  }
}

module.exports = { connectToOpenAI, sendAudioToOpenAI };