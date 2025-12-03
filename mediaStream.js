const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Media Stream WebSocket ready');

  wss.on('connection', (ws) => {
    let callId = null;
    let chunkCount = 0;

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message.toString());

        if (msg.event === 'start') {
          callId = msg.start?.call_control_id;
          logger.info(`📞 Stream started`);
          logger.info(`Format: ${JSON.stringify(msg.start?.media_format)}`);
          
          if (callId) {
            attachTelnyxStream(callId, ws);
          }
        }

        if (msg.event === 'media' && msg.media?.payload && callId) {
          chunkCount++;
          if (chunkCount % 100 === 0) {
            logger.info(`📥 ${chunkCount} chunks received`);
          }
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
  });
}

module.exports = { setupMediaStreamWebSocket };