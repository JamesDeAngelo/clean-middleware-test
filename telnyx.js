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
        logger.info('✓ Streaming started');
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
  logger.info('📞 Call initiated');
  
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
    
    logger.info('✓ Call answered');
  } catch (error) {
    logger.error(`Failed to answer: ${error.message}`);
  }
}

async function handleCallAnswered(callControlId, payload) {
  logger.info('✓ Call answered event');
  
  try {
    // Connect to OpenAI first and store callControlId in session
    await connectToOpenAI(callControlId);
    
    // Store callControlId in the session so we can use it later
    const session = sessionStore.getSession(callControlId);
    if (session) {
      session.callControlId = callControlId;
      sessionStore.updateSession(callControlId, session);
    }
    
    const streamUrl = `${RENDER_URL}/media-stream`;
    
    // CRITICAL FIX: Request PCMU (G.711 µ-law) @ 8kHz to match OpenAI
    const streamingConfig = {
      stream_url: streamUrl,
      stream_track: 'inbound',  // Only receive user audio, we'll use playback API for output
      enable_dialogflow: false,
      media_format: {
        codec: 'PCMU',  // G.711 µ-law encoding
        sample_rate: 8000,  // Standard telephony rate
        channels: 1
      }
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
    
    logger.info('✓ Streaming started with PCMU @ 8kHz (inbound only)');
    
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
  logger.info('✓ Cleanup completed');
}

async function handleCallHangup(callControlId) {
  const session = sessionStore.getSession(callControlId);
  
  if (session?.ws?.readyState === 1) {
    session.ws.close();
  }
  
  sessionStore.deleteSession(callControlId);
  logger.info('✓ Call ended');
}

module.exports = { handleWebhook };