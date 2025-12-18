const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { connectToOpenAI } = require('./websocket');
const { saveToAirtable } = require('./airtable');
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
    
    // LOG THE ENTIRE PAYLOAD for debugging
    if (eventType === 'call.initiated' || eventType === 'call.answered') {
      logger.info(`📋 Full payload: ${JSON.stringify(payload, null, 2)}`);
    }
    
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
  
  // Capture caller's phone number from Telnyx
  const callerPhoneNumber = payload?.from || '';
  logger.info(`📞 Caller ID: ${callerPhoneNumber}`);
  
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
  
  // Get caller's phone number - try multiple fields
  const callerPhoneNumber = payload?.from || payload?.caller_id_number || payload?.call_leg_id || '';
  logger.info(`📞 Raw payload.from: ${payload?.from}`);
  logger.info(`📞 Raw payload.caller_id_number: ${payload?.caller_id_number}`);
  logger.info(`📞 Using phone number: ${callerPhoneNumber}`);
  
  try {
    // Connect to OpenAI first and store callControlId in session
    await connectToOpenAI(callControlId, callerPhoneNumber);
    
    // Store callControlId in the session
    const session = sessionStore.getSession(callControlId);
    if (session) {
      session.callControlId = callControlId;
      sessionStore.updateSession(callControlId, session);
    }
    
    const streamUrl = `${RENDER_URL}/media-stream`;
    
    // Simplified streaming config - don't use bidirectional RTP for now
    const streamingConfig = {
      stream_url: streamUrl,
      stream_track: 'both_tracks',
      enable_dialogflow: false
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
    
    logger.info('✓ Streaming started with both_tracks mode');
    
  } catch (error) {
    logger.error(`Failed to initialize: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function handleStreamingStopped(callControlId) {
  logger.info(`🔴 Streaming stopped for call: ${callControlId}`);
  const session = sessionStore.getSession(callControlId);
  
  if (session) {
    // Don't save here - let call.hangup handle the final save
    if (session.ws?.readyState === 1) {
      session.ws.close();
    }
  }
  
  logger.info('✓ Streaming stop handled');
}

async function handleCallHangup(callControlId) {
  logger.info(`🔴 Call hangup for: ${callControlId}`);
  const session = sessionStore.getSession(callControlId);
  
  if (session) {
    // Final save attempt
    if (session.dataExtractor && !session.dataSaved) {
      const leadData = session.dataExtractor.getData();
      if (leadData.phoneNumber) {
        logger.info('💾 Final save on call hangup');
        await saveToAirtable(leadData);
      }
    }
    
    if (session.ws?.readyState === 1) {
      session.ws.close();
    }
    
    sessionStore.deleteSession(callControlId);
  }
  
  logger.info('✓ Call ended');
}

module.exports = { handleWebhook };