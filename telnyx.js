const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { connectToOpenAI } = require('./websocket');
const axios = require('axios');

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2/calls';
const RENDER_URL = process.env.RENDER_URL || `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}`;

async function handleWebhook(req, res) {
  try {
    const eventType = req.body?.data?.event_type;
    const payload = req.body?.data?.payload || {};
    const callControlId = payload?.call_control_id;
    
    logger.info(`Event: ${eventType}`);
    
    if (!callControlId && eventType !== 'call.hangup') {
      return res.status(400).send('Missing call_control_id');
    }
    
    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(callControlId, payload);
        return res.status(200).send('OK');

      case 'call.answered':
        await handleCallAnswered(callControlId, payload);
        return res.status(200).send('OK');

      case 'streaming.started':
        logger.info(`✓ Streaming started`);
        return res.status(200).send('OK');

      case 'streaming.stopped':
        await handleStreamingStopped(callControlId);
        return res.status(200).send('OK');

      case 'call.hangup':
        await handleCallHangup(callControlId);
        return res.status(200).send('OK');

      default:
        return res.status(200).send('OK');
    }
    
  } catch (error) {
    logger.error(`Webhook error: ${error.message}`);
    return res.status(500).send('Internal Server Error');
  }
}

async function handleCallInitiated(callControlId, payload) {
  logger.info(`📞 Call initiated`);
  
  try {
    await axios.post(
      `${TELNYX_API_URL}/${callControlId}/actions/answer`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`✓ Call answered`);
  } catch (error) {
    logger.error(`Failed to answer: ${error.message}`);
  }
}

async function handleCallAnswered(callControlId, payload) {
  logger.info(`✓ Call answered event`);
  
  try {
    await connectToOpenAI(callControlId);
    
    const streamUrl = `${RENDER_URL}/media-stream`;
    
    // CRITICAL: Use L16 codec (linear PCM) for AI integrations
    // This matches OpenAI's PCM16 format without transcoding
    const streamingConfig = {
      stream_url: streamUrl,
      stream_track: 'both_tracks',
      codec: 'L16',           // Linear PCM codec
      sample_rate: 24000      // Match OpenAI's 24kHz
    };
    
    logger.info(`Starting stream with config: ${JSON.stringify(streamingConfig)}`);
    
    await axios.post(
      `${TELNYX_API_URL}/${callControlId}/actions/streaming_start`,
      streamingConfig,
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`✓ Streaming started with L16 codec @ 24kHz`);
    
  } catch (error) {
    logger.error(`Failed to initialize: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function handleStreamingStopped(callControlId) {
  const session = sessionStore.getSession(callControlId);
  
  if (session?.ws?.readyState === 1) {
    session.ws.close();
  }
  
  sessionStore.deleteSession(callControlId);
  logger.info(`✓ Cleanup completed`);
}

async function handleCallHangup(callControlId) {
  const session = sessionStore.getSession(callControlId);
  
  if (session?.ws?.readyState === 1) {
    session.ws.close();
  }
  
  sessionStore.deleteSession(callControlId);
  logger.info(`✓ Call ended`);
}

module.exports = { handleWebhook };