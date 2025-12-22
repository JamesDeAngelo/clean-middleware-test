const logger = require('./utils/logger');
const { attachTelnyxStream, forwardAudioToOpenAI } = require('./websocket');

function setupMediaStreamWebSocket(wss) {
  logger.info('Media Stream WebSocket ready');
  
  wss.on('connection', (ws) => {
    let callId = null;
    let streamSid = null;
    let inboundChunks = 0;
    let outboundChunks = 0;
    
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
          const track = msg.media.track;
          
          // CRITICAL FIX: Only forward INBOUND audio to OpenAI
          // This prevents OpenAI from hearing itself (echo/feedback loop)
          if (track === 'inbound') {
            inboundChunks++;
            
            if (inboundChunks % 100 === 0) {
              logger.info(`📥 ${inboundChunks} inbound chunks received (user audio)`);
            }
            
            // Send user's audio to OpenAI for processing
            forwardAudioToOpenAI(callId, msg.media.payload);
          } else if (track === 'outbound') {
            // This is audio going TO the user (AI's voice or hold music)
            // We DON'T send this to OpenAI - it would create feedback
            outboundChunks++;
            
            if (outboundChunks % 100 === 0) {
              logger.info(`📤 ${outboundChunks} outbound chunks (AI audio to user)`);
            }
          }
        }
        
        if (msg.event === 'stop') {
          logger.info(`Stream ended: ${inboundChunks} inbound, ${outboundChunks} outbound chunks`);
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


