const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body.data;
  if (!event || !event.payload) return res.sendStatus(200);

  const callControlId = event.payload.call_control_id;

  // Only respond to initiated events
  if (event.event_type === 'call.initiated') {
    // Answer the call via Telnyx API
    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
      {},
      { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` } }
    );
  }

  // TWiML to speak and hang up
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="female" language="en-US">
    Hello. This is your AI. The webhook works.
  </Speak>
  <Hangup/>
</Response>`;

  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

app.listen(process.env.PORT || 3000, () => console.log('Server running'));
