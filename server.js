const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Health check
app.get('/', (req, res) => res.send('Voiceflow-Telnyx TexML webhook live!'));

// Telnyx TexML webhook
app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body.data;

  if (!event || !event.payload) return res.sendStatus(200);

  console.log('📞 Incoming TexML event:', JSON.stringify(event, null, 2));

  // Only handle incoming calls
  if (event.event_type === 'call.initiated') {
    const caller = event.payload.from;
    const callControlId = event.payload.call_control_id;

    // TexML response to auto-answer and connect to Voiceflow
    // Voiceflow webhook should handle the dynamic response logic
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="alloy" language="en-US">
    Connecting you to AI...
  </Speak>
  <Connect>
    <Sip uri="sip:ai-bot@sip.telnyx.com"/>
  </Connect>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(texmlResponse);

    console.log(`✅ TexML sent to answer and connect caller ${caller}`);
  } else {
    // For all other events, just respond 200
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
