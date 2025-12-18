const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Media Stream WebSocket ready');
  
  wss.on('connection', (ws) => {
    let callId = null;
    let streamSid = null;
    let chunkCount = 0;
    let keepAliveInterval = null;
    
    logger.info('📞 New WebSocket connection established');
    
    // Keep connection alive
    keepAliveInterval = setInterval(() => {
      if (ws.readyState === 1) {
        try {
          ws.ping();
        } catch (err) {
          logger.error(`Ping error: ${err.message}`);
        }
      }
    }, 30000); // Ping every 30 seconds
    
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
            logger.info(`📥 ${chunkCount} chunks received from Telnyx (track: ${msg.media.track})`);
          }
          
          // Log first inbound chunk to verify we're receiving caller audio
          if (chunkCount === 1) {
            logger.info(`📥 First chunk: track=${msg.media.track}, payload_length=${msg.media.payload?.length}`);
          }
          
          // Only forward inbound audio to OpenAI
          if (msg.media.track === 'inbound' || !msg.media.track) {
            forwardAudioToOpenAI(callId, msg.media.payload);
          }
        }
        
        if (msg.event === 'stop') {
          logger.info(`⛔ Stream STOP event received. Total chunks: ${chunkCount}`);
        }
        
      } catch (err) {
        logger.error(`Message error: ${err.message}`);
      }
    });
    
    ws.on('error', (err) => {
      logger.error(`WS error: ${err.message}`);
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
    });
    
    ws.on('close', () => {
      logger.info(`WebSocket closed for call: ${callId}`);
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
    });
    
    ws.on('pong', () => {
      // Connection is alive
    });
  });
}

module.exports = { setupMediaStreamWebSocket };