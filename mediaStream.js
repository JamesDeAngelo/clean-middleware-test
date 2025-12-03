const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Setting up Media Stream WebSocket server');

  wss.on('connection', (ws, req) => {
    logger.info(`New WebSocket connection from: ${req.socket.remoteAddress}`);

    let callId = null;
    let streamSid = null;
    let audioChunkCount = 0;

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.event) {
          case 'connected':
            logger.info(`Telnyx WebSocket connected`);
            break;

          case 'start':
            callId = msg.start?.call_control_id || msg.start?.callControlId;
            streamSid = msg.start?.stream_sid || msg.start?.streamSid;
            
            logger.info(`✓ Stream started for call: ${callId}`);
            logger.info(`Stream details: ${JSON.stringify(msg.start)}`);
            
            if (callId) {
              attachTelnyxStream(callId, ws);
            } else {
              logger.error('❌ No call_control_id in start event');
            }
            break;

          case 'media':
            if (msg.media && msg.media.payload && callId) {
              audioChunkCount++;
              if (audioChunkCount % 50 === 0) {
                logger.info(`📥 Received ${audioChunkCount} audio chunks from caller`);
              }
              forwardAudioToOpenAI(callId, msg.media.payload);
            }
            break;

          case 'stop':
            logger.info(`Stream stopped - Call ID: ${callId}`);
            logger.info(`Total audio chunks received: ${audioChunkCount}`);
            break;

          default:
            logger.info(`Telnyx event: ${msg.event}`);
            break;
        }
      } catch (err) {
        logger.error(`Error processing Telnyx message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      logger.info(`Telnyx WebSocket closed for call: ${callId}`);
    });

    ws.on('error', (err) => {
      logger.error(`Telnyx WebSocket error: ${err.message}`);
    });
  });

  logger.info('Media Stream WebSocket server ready');
}

module.exports = { setupMediaStreamWebSocket };