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
    
    logger.info(`📡 Webhook Event: ${eventType}`);
    
    if (!callControlId && eventType !== 'call.hangup') {
      logger.warn('⚠️ Missing call_control_id in webhook');
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
        logger.info('✅ Streaming started successfully');
        return res.status(200).send('OK');
        
      case 'streaming.stopped':
        await handleStreamingStopped(callControlId);
        return res.status(200).send('OK');
        
      case 'call.hangup':
        await handleCallHangup(callControlId);
        return res.status(200).send('OK');
        
      default:
        logger.info(`ℹ️ Unhandled event: ${eventType}`);
        return res.status(200).send('OK');
    }
    
  } catch (error) {
    logger.error(`❌ Webhook error: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    return res.status(500).send('Internal Server Error');
  }
}

async function handleCallInitiated(callControlId, payload) {
  logger.info('📞 CALL INITIATED');
  
  const callerPhone = payload.from || payload.caller_id_number || "Unknown";
  
  logger.info(`📱 Incoming call from: ${callerPhone}`);
  logger.info(`🆔 Call Control ID: ${callControlId}`);
  
  try {
    logger.info('🔄 Answering call IMMEDIATELY...');
    
    // ANSWER IMMEDIATELY - No delay
    const response = await axios.post(
      `${TELNYX_API_URL}/${callControlId}/actions/answer`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 3000  // Reduced timeout for faster response
      }
    );
    
    logger.info('✅ Call answered INSTANTLY!');
    
  } catch (error) {
    logger.error(`❌ FAILED TO ANSWER CALL: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx API Error: ${JSON.stringify(error.response.data)}`);
      logger.error(`Status Code: ${error.response.status}`);
    }
  }
}

async function handleCallAnswered(callControlId, payload) {
  logger.info('✅ CALL ANSWERED EVENT RECEIVED');
  
  try {
    const callerPhone = payload.from || payload.caller_id_number || "Unknown";
    logger.info(`📱 Caller phone: ${callerPhone}`);
    
    // Connect to OpenAI IMMEDIATELY
    logger.info('🔄 Connecting to OpenAI...');
    await connectToOpenAI(callControlId);
    logger.info('✅ OpenAI connection established');
    
    // Store caller info in session
    const session = sessionStore.getSession(callControlId);
    if (session) {
      session.callControlId = callControlId;
      session.callerPhone = callerPhone;
      sessionStore.updateSession(callControlId, session);
      logger.info(`💾 Session updated with caller: ${callerPhone}`);
    } else {
      logger.warn('⚠️ No session found for this call');
    }
    
    const streamUrl = `${RENDER_URL}/media-stream`;
    logger.info(`🎙️ Stream URL: ${streamUrl}`);
    
    // NUCLEAR FIX: Only send caller's audio + aggressive echo cancellation
    const streamingConfig = {
      stream_url: streamUrl,
      stream_track: 'inbound_track',        // ONLY caller audio - NO AI echo
      stream_bidirectional_mode: 'rtp',
      stream_bidirectional_codec: 'PCMU',
      enable_dialogflow: false,
      enable_echo_cancellation: true,       // Enable echo cancellation
      enable_comfort_noise: false,          // DISABLE comfort noise (stops hissing)
      media_format: {
        codec: 'PCMU',
        sample_rate: 8000,
        channels: 1
      }
    };
    
    logger.info('🔄 Starting audio streaming (echo cancellation + no comfort noise)...');
    
    const response = await axios.post(
      `${TELNYX_API_URL}/${callControlId}/actions/streaming_start`,
      streamingConfig,
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 3000
      }
    );
    
    logger.info('✅ Streaming started with FULL echo protection!');
    
  } catch (error) {
    logger.error(`❌ FAILED TO INITIALIZE CALL: ${error.message}`);
    if (error.response) {
      logger.error(`Telnyx API Error: ${JSON.stringify(error.response.data)}`);
      logger.error(`Status Code: ${error.response.status}`);
    }
    if (error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }
  }
}

async function saveSessionDataBeforeCleanup(callControlId) {
  try {
    // Check if already saved to prevent duplicates
    if (sessionStore.wasSaved(callControlId)) {
      logger.info(`⏭️ Already saved - skipping duplicate save`);
      return;
    }
    
    const session = sessionStore.getSession(callControlId);
    
    if (!session) {
      logger.warn(`⚠️ No session found for ${callControlId}`);
      return;
    }
    
    // ALWAYS SAVE - even if no transcript or incomplete call
    // Minimum requirement: phone number (always available)
    const transcript = sessionStore.getFullTranscript(callControlId) || "";
    const userTranscript = sessionStore.getUserTranscript(callControlId) || "";
    const callerPhone = session.callerPhone || "Unknown";
    
    logger.info(`💾 ALWAYS SAVING - Phone: ${callerPhone}`);
    
    if (transcript.trim().length > 0) {
      logger.info(`📋 Transcript (${transcript.length} chars):\n${transcript}`);
    } else {
      logger.info(`📋 No transcript - caller hung up immediately or didn't speak`);
    }
    
    // Extract whatever data we can from the transcript
    // If transcript is empty, this will return mostly empty fields but WILL have phone number
    const leadData = await extractLeadDataFromTranscript(transcript, callerPhone);
    
    // ADD MISSING FIELDS FOR AIRTABLE
    leadData.rawTranscript = transcript; // Full conversation (both AI and user)
    leadData.rawTranscriptInput = userTranscript; // User input only
    
    // Determine if qualified based on data completeness
    const hasName = leadData.name && leadData.name.trim() !== "";
    const hasDate = leadData.dateOfAccident && leadData.dateOfAccident.trim() !== "";
    const hasLocation = leadData.accidentLocation && leadData.accidentLocation.trim() !== "";
    const hasCommercialTruck = leadData.wasCommercialTruckInvolved === "Yes";
    
    // Qualified if they have: name, date, location, and it was a commercial truck
    if (hasName && hasDate && hasLocation && hasCommercialTruck) {
      leadData.qualified = "Qualified";
    } else if (hasName || hasDate || hasLocation) {
      leadData.qualified = "Needs Review";
    } else {
      leadData.qualified = "Unqualified";
    }
    
    // ALWAYS save to Airtable - even with minimal data
    await saveLeadToAirtable(leadData);
    
    sessionStore.markAsSaved(callControlId);
    
    logger.info(`✅ SAVED TO AIRTABLE - Phone: ${callerPhone}, Name: ${leadData.name || 'Not provided'}, Qualified: ${leadData.qualified}`);
    
  } catch (error) {
    logger.error(`❌ Save failed: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    // Even if save fails, we tried - don't crash
  }
}

async function handleStreamingStopped(callControlId) {
  // DON'T save here - let call.hangup handle it
  logger.info('🛑 Streaming stopped - waiting for hangup event');
}

async function handleCallHangup(callControlId) {
  logger.info('📴 CALL HANGUP EVENT');
  
  // ONLY SAVE HERE - single point of saving
  await saveSessionDataBeforeCleanup(callControlId);
  
  const session = sessionStore.getSession(callControlId);
  
  if (session?.ws?.readyState === 1) {
    logger.info('🔌 Closing WebSocket connection...');
    session.ws.close();
  }
  
  sessionStore.deleteSession(callControlId);
  logger.info('✅ Call ended and session cleaned up');
}

module.exports = { handleWebhook };
