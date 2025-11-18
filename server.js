const express = require('express');
const app = express();

// Parse JSON & URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => res.send('TexML + Voiceflow webhook live!'));

// Main webhook
app.post('/texml-webhook', (req, res) => {
  const event = req.body;

  console.log('🚨 Webhook HIT');
  console.log('📞 Incoming TexML event:', JSON.stringify(event, null, 2));

  // Detect incoming call
  if (event.CallbackSource === 'call-progress-events' && event.CallStatus === 'ringing') {
    const caller = event.From || 'unknown';

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
    // Respond 200 to all other events
    res.sendStatus(200);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
