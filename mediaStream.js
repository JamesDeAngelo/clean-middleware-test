const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Media Stream WebSocket ready');

  wss.on('connection', (ws) => {
    let callId = null;
    let chunkCount = 0;

    logger.info('📞 New WebSocket connection established');

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message.toString());

        if (msg.event === 'start') {
          callId = msg.start?.call_control_id;
          logger.info(`📞 Stream started for call: ${callId}`);
          logger.info(`Format: ${JSON.stringify(msg.start?.media_format)}`);
          
          if (callId) {
            attachTelnyxStream(callId, ws);
          } else {
            logger.error('❌ No call_control_id in start event');
          }
        }

        if (msg.event === 'media' && msg.media?.payload && callId) {
          chunkCount++;
          
          if (chunkCount % 100 === 0) {
            logger.info(`📥 ${chunkCount} chunks received from Telnyx`);
          }
          
          // Forward inbound audio to OpenAI
          forwardAudioToOpenAI(callId, msg.media.payload);
        }

        if (msg.event === 'stop') {
          logger.info(`Stream ended: ${chunkCount} total chunks`);
        }

      } catch (err) {
        logger.error(`Message error: ${err.message}`);
      }
    });

    ws.on('error', (err) => {
      logger.error(`WS error: ${err.message}`);
    });

    ws.on('close', () => {
      logger.info(`WebSocket closed for call: ${callId}`);
    });
  });
}

module.exports = { setupMediaStreamWebSocket };