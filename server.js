const express = require('express');
const app = express();

// Parse incoming JSON from Telnyx
app.use(express.json());

// Health check
app.get('/', (req, res) => res.send('TexML + Voiceflow webhook live!'));

// Main TexML webhook
app.post('/texml-webhook', (req, res) => {
  const event = req.body.data || req.body;

  console.log('🚨 Webhook HIT');
  console.log('📞 Incoming TexML event:', JSON.stringify(event, null, 2));

  if (event && event.payload && event.event_type === 'call.initiated') {
    const caller = event.payload.from;

    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="alloy" language="en-US">
    Hello! Connecting you to AI now.
  </Speak>
  <Connect>
    <Sip uri="sip:ai1@sip.telnyx.com"/>
  </Connect>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(texmlResponse);

    console.log(`✅ TexML sent to answer and connect caller ${caller}`);
  } else {
    res.sendStatus(200);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
