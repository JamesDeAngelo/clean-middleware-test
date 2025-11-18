const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => res.send('AI Voice Bot is live!'));

// Telnyx Voice API webhook
app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body.data;
  if (!event || !event.payload) return res.sendStatus(200);

  const callControlId = event.payload.call_control_id;

  try {
    // 1️⃣ Answer the call when it's initiated
    if (event.event_type === 'call.initiated') {
      console.log(`📞 Incoming call detected: ${callControlId}`);

      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
        {},
        { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` } }
      );

      console.log('✅ Call answered');
    }

    // 2️⃣ Play TTS audio only after the call is answered
    if (event.event_type === 'call.answered') {
      console.log(`🎤 Call answered confirmed: ${callControlId}, playing TTS`);

      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/play`,
        {
          audio: [
            {
              type: 'tts',
              payload: 'Hello. This is your AI. The webhook works.',
              voice: 'alloy',       // Valid Telnyx voice
              language: 'en-US'
            }
          ]
        },
        { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` } }
      );

      console.log('✅ TTS audio played');

      // 3️⃣ Hang up after audio finishes
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
        {},
        { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` } }
      );

      console.log('✅ Call hung up');
    }

  } catch (err) {
    console.error('⚠️ Error handling call:', err.response?.data || err.message);
  }

  // Always respond 200 to Telnyx webhook
  res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
