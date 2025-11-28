const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { connectToOpenAI, sendAudioToOpenAI } = require('./websocket');

async function handleWebhook(req, res) {
  logger.info('Webhook received');
  const { call_control_id, event_type, payload } = req.body.data || {};
  if (!call_control_id) {
    logger.error('Missing call_control_id in webhook');
    return res.status(400).send('Missing call_control_id');
  }
  switch (event_type) {
    case 'call.initiated':
      logger.info(`Call started: ${call_control_id}`);
      sessionStore.createSession(call_control_id, null);
      res.set('Content-Type', 'text/xml');
      return res.send(`<Response>
  <Say voice="female">Please wait.</Say>
</Response>`);
    case 'call.answered':
      logger.info(`Call answered: ${call_control_id}`);
      try {
        await connectToOpenAI(call_control_id);
      } catch (error) {
        logger.error(`Failed to connect to OpenAI: ${error.message}`);
      }
      return res.status(200).send('OK');
    case 'call.bridged':
      logger.info(`Call answered/bridged: ${call_control_id}`);
      return res.status(200).send('OK');
    case 'streaming.audio':
      try {
        const audioChunk = payload?.audio;
        if (audioChunk) {
          logger.info(`Audio chunk received: ${audioChunk.substring(0, 50)}`);
          logger.info(`Audio chunk size: ${audioChunk.length}`);
          logger.info(`Session exists for call: ${sessionStore.getSession(call_control_id) ? 'YES' : 'NO'}`);
          if (!sessionStore.getSession(call_control_id)) {
            logger.error(`No session found for call_control_id: ${call_control_id}`);
            return res.status(200).send('OK');
          }
          await sendAudioToOpenAI(call_control_id, audioChunk);
        }
      } catch (error) {
        logger.error(`Failed to forward audio to OpenAI: ${error.message}`);
      }
      return res.status(200).send('OK');
    default:
      logger.info(`Event type ignored: ${event_type}`);
      return res.status(200).send('OK');
  }
}
module.exports = { handleWebhook };