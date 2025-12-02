const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Setting up Media Stream WebSocket server');

  wss.on('connection', (ws, req) => {
    logger.info(`New WebSocket connection from: ${req.socket.remoteAddress}`);

    let callId = null;
    let streamSid = null;

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message.toString());
        logger.info(`Received Telnyx message type: ${msg.event}`);

        switch (msg.event) {
          case 'start':
            // Extract call control ID from the stream metadata
            callId = msg.start?.call_control_id || msg.start?.callControlId;
            streamSid = msg.start?.stream_sid || msg.start?.streamSid;
            
            logger.info(`Stream started - Call ID: ${callId}, Stream SID: ${streamSid}`);
            
            if (callId) {
              // Attach this Telnyx WebSocket to the OpenAI session
              attachTelnyxStream(callId, ws);
            } else {
              logger.error('No call_control_id found in start event');
            }
            break;

          case 'media':
            // Forward incoming audio to OpenAI
            if (msg.media && msg.media.payload && callId) {
              forwardAudioToOpenAI(callId, msg.media.payload);
            }
            break;

          case 'stop':
            logger.info(`Stream stopped - Call ID: ${callId}`);
            break;

          default:
            logger.info(`Unhandled Telnyx event: ${msg.event}`);
        }
      } catch (err) {
        logger.error(`Error processing Telnyx message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      logger.info(`WebSocket closed for call: ${callId}`);
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error for call ${callId}: ${err.message}`);
    });
  });

  logger.info('Media Stream WebSocket server ready');
}

module.exports = { setupMediaStreamWebSocket };