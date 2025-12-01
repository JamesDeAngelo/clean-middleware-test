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
  
  // Return a Promise that resolves when WS is open
  return new Promise((resolve, reject) => {
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
        
        // Resolve the Promise now that WS is ready
        resolve(ws);
      } catch (error) {
        logger.error(`Failed to send initial payload: ${error.message}`);
        reject(error);
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
          logger.info('Speech started, committing audio buffer');
          ws.send(JSON.stringify({
            type: 'input_audio_buffer.commit'
          }));
        }

        if (message.type === 'input_audio_buffer.speech_stopped') {
          logger.info('Speech stopped, creating response');
          ws.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio']
            }
          }));
        }
        
        // Send audio back to Telnyx
        if (message.type === 'response.audio.delta' && message.delta) {
          const streamId = sessionStore.getStreamId(callId);
          const session = sessionStore.getSession(callId);
          const call_control_id = session?.call_control_id;
          if (streamId && call_control_id) {
            await sendAudioToTelnyx(call_control_id, streamId, message.delta);
          } else {
            logger.error(`No streamId or call_control_id found for callId: ${callId}`);
          }
        }
        
        if (message.type === 'response.audio.done') {
          logger.info('Response audio output completed');
        }
        
        if (message.type === 'response.done') {
          logger.info('Response completed');
        }
        
        if (message.type === 'error') {
          logger.error(`OpenAI error: ${JSON.stringify(message.error)}`);
        }
      } catch (error) {
        logger.error(`Failed to process OpenAI message: ${error.message}`);
      }
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
      reject(error);
    });

    ws.on('close', () => {
      logger.info('OpenAI WebSocket closed');
      sessionStore.deleteSession(callId);
    });
  });
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

async function sendAudioToTelnyx(call_control_id, streamId, audioChunk) {
  try {
    if (!streamId) {
      logger.error(`Missing streamId for call_control_id: ${call_control_id}`);
      return;
    }

    await axios.post(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/streaming_send`,
      {
        stream_id: streamId,
        payload: audioChunk
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
    if (error.response) {
      logger.error(`Telnyx API error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

module.exports = { connectToOpenAI, sendAudioToOpenAI, sendAudioToTelnyx };