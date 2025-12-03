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

        switch (msg.event) {
          case 'start':
            callId = msg.start?.call_control_id || msg.start?.callControlId;
            streamSid = msg.start?.stream_sid || msg.start?.streamSid;
            
            logger.info(`✓ Stream started - Call ID: ${callId}`);
            
            if (callId) {
              attachTelnyxStream(callId, ws);
            } else {
              logger.error('No call_control_id in start event');
            }
            break;

          case 'media':
            if (msg.media && msg.media.payload && callId) {
              forwardAudioToOpenAI(callId, msg.media.payload);
            }
            break;

          case 'stop':
            logger.info(`Stream stopped - Call ID: ${callId}`);
            break;

          default:
            // Silently ignore other events
            break;
        }
      } catch (err) {
        logger.error(`Error processing message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      logger.info(`WebSocket closed for call: ${callId}`);
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
    });
  });

  logger.info('Media Stream WebSocket server ready');
}

module.exports = { setupMediaStreamWebSocket };