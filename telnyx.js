const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { connectToOpenAI } = require('./websocket');
const { saveLeadToAirtable } = require('./airtable');
const { extractLeadDataFromTranscript } = require('./openai');
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
  
  const callerPhone = payload.from || payload.caller_id_number || null;
  
  if (callerPhone) {
    logger.info(`📱 Caller: ${callerPhone}`);
  }
  
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
    await connectToOpenAI(callControlId);
    
    const callerPhone = payload.from || payload.caller_id_number || null;
    
    const session = sessionStore.getSession(callControlId);
    if (session) {
      session.callControlId = callControlId;
      session.callerPhone = callerPhone;
      sessionStore.updateSession(callControlId, session);
      logger.info(`📱 Stored: ${callerPhone}`);
    }
    
    const streamUrl = `${RENDER_URL}/media-stream`;
    
    const streamingConfig = {
      stream_url: streamUrl,
      stream_track: 'both_tracks',
      stream_bidirectional_mode: 'rtp',
      stream_bidirectional_codec: 'PCMU',
      enable_dialogflow: false,
      media_format: {
        codec: 'PCMU',
        sample_rate: 8000,
        channels: 1
      }
    };
    
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
    
    logger.info('✓ Streaming started');
    
  } catch (error) {
    logger.error(`Failed to initialize: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function saveSessionDataBeforeCleanup(callControlId) {
  try {
    if (sessionStore.wasSaved(callControlId)) {
      logger.info(`⏭️ Already saved`);
      return;
    }
    
    const session = sessionStore.getSession(callControlId);
    
    if (!session) {
      logger.warn(`⚠️ No session to save`);
      return;
    }
    
    // Check if conversation completed naturally (AI said goodbye)
    if (!sessionStore.isConversationComplete(callControlId)) {
      logger.warn(`⚠️ Conversation incomplete - caller hung up early. Not saving.`);
      return;
    }
    
    const transcript = sessionStore.getFullTranscript(callControlId);
    
    if (!transcript || transcript.trim().length === 0) {
      logger.warn(`⚠️ No transcript`);
      return;
    }
    
    // Check if we have enough data (at least name mentioned)
    const hasName = transcript.toLowerCase().includes("name") || 
                   transcript.match(/my name is|i'm |i am /i);
    
    if (!hasName) {
      logger.warn(`⚠️ No name captured - likely incomplete call`);
      return;
    }
    
    logger.info(`💾 Saving complete call data...`);
    logger.info(`📋 Transcript:\n${transcript}`);
    
    const leadData = await extractLeadDataFromTranscript(transcript, session.callerPhone);
    
    await saveLeadToAirtable(leadData);
    
    sessionStore.markAsSaved(callControlId);
    
    logger.info(`✅ SAVED TO AIRTABLE!`);
    
  } catch (error) {
    logger.error(`❌ Save failed: ${error.message}`);
  }
}

async function handleStreamingStopped(callControlId) {
  // SAVE BEFORE CLEANUP (only if conversation complete)
  await saveSessionDataBeforeCleanup(callControlId);
  
  const session = sessionStore.getSession(callControlId);
  
  if (session?.ws?.readyState === 1) {
    session.ws.close();
  }
  
  sessionStore.deleteSession(callControlId);
  logger.info('✓ Cleanup completed');
}

async function handleCallHangup(callControlId) {
  // SAVE BEFORE CLEANUP (only if conversation complete)
  await saveSessionDataBeforeCleanup(callControlId);
  
  const session = sessionStore.getSession(callControlId);
  
  if (session?.ws?.readyState === 1) {
    session.ws.close();
  }
  
  sessionStore.deleteSession(callControlId);
  logger.info('✓ Call ended');
}

module.exports = { handleWebhook };