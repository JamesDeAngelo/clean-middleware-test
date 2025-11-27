const { startRealtimeSession } = require('./aiAgent');
const LAWYER_CONFIGS = require('../config/lawyers');

async function handleIncomingCall(req, res) {
  try {
    const payload = req.body;
    const lawyerPhone = payload.data?.payload?.to;

    console.log('Incoming call to:', lawyerPhone);

    const lawyerConfig = LAWYER_CONFIGS[lawyerPhone];

    if (!lawyerConfig) {
      console.error('No config for number:', lawyerPhone);
      return res.status(400).send('No config for this number');
    }

    // Start the real-time AI session
    startRealtimeSession(payload, lawyerConfig);

    res.status(200).send({ status: 'processing' });
  } catch (error) {
    console.error('Error handling call:', error);
    res.status(500).send('Error processing call');
  }
}

module.exports = { handleIncomingCall };