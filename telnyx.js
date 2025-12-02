const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { connectToOpenAI } = require('./websocket');
const axios = require('axios');

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2/calls';

// FIXED: Use wss:// protocol and correct URL format
const RENDER_URL = process.env.RENDER_URL || `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}`;

async function handleWebhook(req, res) {
  try {
    logger.info('Webhook received');
    logger.info(`Full webhook body: ${JSON.stringify(req.body)}`);
    
    const eventType = req.body?.data?.event_type;
    const payload = req.body?.data?.payload || {};
    const callControlId = payload?.call_control_id;
    
    logger.info(`Event: ${eventType}, Call ID: ${callControlId}`);
    
    if (!callControlId) {
      logger.error('Missing call_control_id in webhook');
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
        logger.info(`Streaming started for call: ${callControlId}`);
        return res.status(200).send('OK');

      case 'streaming.stopped':
        await handleStreamingStopped(callControlId);
        return res.status(200).send('OK');

      case 'call.hangup':
        await handleCallHangup(callControlId);
        return res.status(200).send('OK');

      default:
        logger.info(`Unhandled event type: ${eventType}`);
        return res.status(200).send('OK');
    }
    
  } catch (error) {
    logger.error(`Error handling webhook: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    return res.status(500).send('Internal Server Error');
  }
}

async function handleCallInitiated(callControlId, payload) {
  logger.info(`Call initiated: ${callControlId}`);
  
  try {
    // Answer the call
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
    
    logger.info(`Call answered: ${callControlId}`);
  } catch (error) {
    logger.error(`Failed to answer call: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function handleCallAnswered(callControlId, payload) {
  logger.info(`Call answered event received: ${callControlId}`);
  
  try {
    // STEP 1: Connect to OpenAI first
    logger.info('Connecting to OpenAI WebSocket...');
    await connectToOpenAI(callControlId);
    logger.info(`OpenAI connected for call: ${callControlId}`);
    
    // STEP 2: Start Telnyx streaming to our WebSocket endpoint
    const streamUrl = `${RENDER_URL}/media-stream`;
    
    logger.info(`Starting Telnyx stream to: ${streamUrl}`);
    
    await axios.post(
      `${TELNYX_API_URL}/${callControlId}/actions/streaming_start`,
      {
        stream_url: streamUrl,
        stream_track: 'inbound_track'
      },
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`Telnyx streaming started: ${callControlId} -> ${streamUrl}`);
    
  } catch (error) {
    logger.error(`Failed to initialize call: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function handleStreamingStopped(callControlId) {
  logger.info(`Streaming stopped: ${callControlId}`);
  
  try {
    const session = sessionStore.getSession(callControlId);
    
    if (session) {
      if (session.ws && session.ws.readyState === 1) {
        session.ws.close();
        logger.info(`Closed OpenAI WebSocket for call: ${callControlId}`);
      }
      
      sessionStore.deleteSession(callControlId);
      logger.info(`Session deleted: ${callControlId}`);
    }
  } catch (error) {
    logger.error(`Cleanup error on streaming.stopped: ${error.message}`);
  }
}

async function handleCallHangup(callControlId) {
  logger.info(`Call hangup: ${callControlId}`);
  
  try {
    const session = sessionStore.getSession(callControlId);
    
    if (session) {
      if (session.ws && session.ws.readyState === 1) {
        session.ws.close();
        logger.info(`Closed OpenAI WebSocket for call: ${callControlId}`);
      }
      
      sessionStore.deleteSession(callControlId);
      logger.info(`Session deleted: ${callControlId}`);
    }
  } catch (error) {
    logger.error(`Cleanup error on hangup: ${error.message}`);
  }
}

module.exports = { handleWebhook };