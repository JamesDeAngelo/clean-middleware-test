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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  ws.on('open', async () => {
    logger.info('OpenAI WebSocket connected');
    sessionStore.createSession(callId, ws);
    
    try {
      const systemPrompt = await buildSystemPrompt();
      const initPayload = await buildInitialRealtimePayload(systemPrompt);
      ws.send(JSON.stringify(initPayload));
      logger.info('Initial session.update payload sent to OpenAI');
    } catch (error) {
      logger.error(`Failed to send initial payload: ${error.message}`);
    }
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      logger.info(`Received OpenAI event: ${message.type}`);

      if (message.type === 'session.updated') {
        logger.info('Session configuration confirmed');
      }

      if (message.type === 'conversation.item.created') {
        logger.info('Conversation item created');
      }

      if (message.type === 'response.output_item.added') {
        logger.info('Response output item added');
      }

      if (message.type === 'input_audio_buffer.speech_started') {
        logger.info('Speech detected, triggering response');
        const responsePayload = {
          type: 'response.create'
        };
        ws.send(JSON.stringify(responsePayload));
      }

      if (message.type === 'output_audio_buffer.delta' && message.audio) {
        await sendAudioToTelnyx(callId, message.audio);
      }

      if (message.type === 'response.audio.delta' && message.delta) {
        await sendAudioToTelnyx(callId, message.delta);
      }

      if (message.type === 'response.completed') {
        logger.info('Response completed');
      }

      if (message.type === 'error') {
        logger.error(`OpenAI error: ${JSON.stringify(message.error)}`);
      }

      if (message.type === 'response.error') {
        logger.error(`Response error: ${JSON.stringify(message)}`);
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
    logger.info('Audio chunk sent to OpenAI');
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