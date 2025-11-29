const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { sendAudioToOpenAI } = require('./websocket');

async function handleMediaStream(req, res) {
  logger.info('Media stream event received');
  logger.info('Media stream payload: ' + JSON.stringify(req.body, null, 2));

  const event_type = req.body?.data?.event_type;
  const payload = req.body?.data?.payload || {};
  const call_control_id = payload?.call_control_id;

  if (!call_control_id) {
    logger.error('Missing call_control_id in media stream');
    return res.status(400).send('Missing call_control_id');
  }

  if (event_type === 'streaming.audio') {
    try {
      const audioChunk = payload?.audio;
      
      if (!audioChunk) {
        logger.error(`No audio data in streaming.audio event for call: ${call_control_id}`);
        return res.status(200).send('OK');
      }

      const session = sessionStore.getSession(call_control_id);
      
      if (!session) {
        logger.error(`No session found for call_control_id: ${call_control_id}`);
        return res.status(200).send('OK');
      }

      logger.info(`Audio chunk received for call ${call_control_id}, size: ${audioChunk.length}`);

      const audioBuffer = Buffer.from(audioChunk, 'base64');
      await sendAudioToOpenAI(call_control_id, audioBuffer);
      
      logger.info(`Audio forwarded to OpenAI for call: ${call_control_id}`);
    } catch (error) {
      logger.error(`Failed to process audio chunk for call ${call_control_id}: ${error.message}`);
    }
  } else {
    logger.info(`Media stream event type ignored: ${event_type}`);
  }

  return res.status(200).send('OK');
}

module.exports = { handleMediaStream };