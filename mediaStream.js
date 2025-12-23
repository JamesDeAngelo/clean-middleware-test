const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Media Stream WebSocket ready');
  
  wss.on('connection', (ws) => {
    let callId = null;
    let streamSid = null;
    let chunkCount = 0;
    
    logger.info('📞 New WebSocket connection established');
    
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message.toString());
        
        if (msg.event === 'start') {
          callId = msg.start?.call_control_id;
          streamSid = msg.start?.stream_id;
          logger.info(`📞 Stream started for call: ${callId}`);
          logger.info(`Stream ID: ${streamSid}`);
          logger.info(`Format: ${JSON.stringify(msg.start?.media_format)}`);
          
          if (callId) {
            attachTelnyxStream(callId, ws, streamSid);
          } else {
            logger.error('❌ No call_control_id in start event');
          }
        }
        
        if (msg.event === 'media' && msg.media?.payload && callId) {
          chunkCount++;
          
          if (chunkCount % 100 === 0) {
            logger.info(`📥 ${chunkCount} chunks received from Telnyx`);
          }
          
          // Only forward inbound audio to OpenAI
          if (msg.media.track === 'inbound' || !msg.media.track) {
            forwardAudioToOpenAI(callId, msg.media.payload);
          }
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



