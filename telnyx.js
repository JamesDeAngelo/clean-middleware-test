const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { connectToOpenAI } = require('./websocket');
const axios = require('axios');

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2/calls';

async function handleWebhook(req, res) {
  logger.info('Webhook received');
  logger.info('Full payload: ' + JSON.stringify(req.body, null, 2));

  const event_type = req.body?.data?.event_type;
  const payload = req.body?.data?.payload || {};
  const call_control_id = payload?.call_control_id;

  if (!call_control_id) {
    logger.error('Missing call_control_id in webhook');
    return res.status(400).send('Missing call_control_id');
  }

  switch (event_type) {
    case 'call.initiated':
      logger.info(`Call initiated: ${call_control_id}`);
      
      try {
        // Answer the call via Telnyx API
        const answerResponse = await axios.post(
          `${TELNYX_API_URL}/${call_control_id}/actions/answer`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        logger.info(`Telnyx answer response: ${JSON.stringify(answerResponse.data)}`);
        logger.info(`Call answered via API: ${call_control_id}`);
      } catch (error) {
        logger.error(`Failed to answer call: ${error.message}`);
        if (error.response) {
          logger.error(`Telnyx API error response: ${JSON.stringify(error.response.data)}`);
        }
      }
      
      // Return XML response
      res.set('Content-Type', 'text/xml');
      return res.send(`<Response>
  <Say voice="female">Please wait while we connect you.</Say>
</Response>`);

    case 'call.answered':
      logger.info(`Call answered: ${call_control_id}`);
      
      try {
        const ws = await connectToOpenAI(call_control_id);
        sessionStore.createSession(call_control_id, ws);
        logger.info(`OpenAI WebSocket connected and stored for call: ${call_control_id}`);
        
        const streamUrl = `wss://clean-middleware-test-1.onrender.com/media-stream`;
        
        const streamingResponse = await axios.post(
          `${TELNYX_API_URL}/${call_control_id}/actions/streaming_start`,
          {
            stream_url: streamUrl,
            stream_track: 'inbound_track'
          },
          {
            headers: {
              'Authorization': `Bearer ${TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        logger.info(`Telnyx streaming_start response: ${JSON.stringify(streamingResponse.data)}`);
        logger.info(`Telnyx audio streaming started for call: ${call_control_id} to ${streamUrl}`);
      } catch (error) {
        logger.error(`Failed to initialize call: ${error.message}`);
        if (error.response) {
          logger.error(`Telnyx API error response: ${JSON.stringify(error.response.data)}`);
        }
      }
      
      return res.status(200).send('OK');

    case 'call.hangup':
      logger.info(`Call hangup: ${call_control_id}`);
      
      try {
        const session = sessionStore.getSession(call_control_id);
        
        if (session) {
          if (session.readyState === 1) {
            session.close();
            logger.info(`WebSocket closed for call: ${call_control_id}`);
          }
          sessionStore.deleteSession(call_control_id);
          logger.info(`Session deleted for call: ${call_control_id}`);
        }
      } catch (error) {
        logger.error(`Failed to cleanup session: ${error.message}`);
      }
      
      return res.status(200).send('OK');

    default:
      logger.info(`Unhandled event type: ${event_type}`);
      return res.status(200).send('OK');
  }
}

module.exports = { handleWebhook };