const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');

function setupMediaStreamWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    logger.info('Telnyx WebSocket connection established');
    
    let call_control_id = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Extract call_control_id from initial message
        if (data.event === 'start' && data.start) {
          call_control_id = data.start.call_control_id;
          logger.info(`Media stream started for call: ${call_control_id}`);
        }
        
        // Handle media (audio) messages
        if (data.event === 'media' && data.media) {
          if (!call_control_id) {
            logger.error('Received media without call_control_id');
            return;
          }
          
          const openAIWebSocket = sessionStore.getSession(call_control_id);
          
          if (openAIWebSocket && openAIWebSocket.readyState === 1) {
            // Forward audio to OpenAI
            const audioPayload = {
              type: 'input_audio_buffer.append',
              audio: data.media.payload
            };
            openAIWebSocket.send(JSON.stringify(audioPayload));
          } else {
            logger.error(`No active OpenAI WebSocket for call: ${call_control_id}`);
          }
        }
        
        // Handle stop event
        if (data.event === 'stop') {
          logger.info(`Media stream stopped for call: ${call_control_id}`);
        }
      } catch (error) {
        logger.error(`Error processing Telnyx message: ${error.message}`);
      }
    });

    ws.on('close', () => {
      logger.info(`Telnyx WebSocket closed for call: ${call_control_id}`);
    });

    ws.on('error', (error) => {
      logger.error(`Telnyx WebSocket error: ${error.message}`);
    });
  });
}

module.exports = { setupMediaStreamWebSocket };