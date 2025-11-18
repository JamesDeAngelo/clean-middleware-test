const express = require('express');
const app = express();

// Parse JSON & URL-encoded payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple health check
app.get('/', (req, res) => res.send('TexML + Voiceflow webhook live!'));

// Keep track of which calls have been answered
const answeredCalls = new Set();

app.post('/texml-webhook', (req, res) => {
  const event = req.body.data || req.body;

  console.log('🚨 Webhook HIT');
  console.log('📞 Incoming TexML event:', JSON.stringify(event, null, 2));

  const callId = event.CallSid || event.CallControlId;

  // Only respond once per call
  if (callId && answeredCalls.has(callId)) {
    return res.sendStatus(200);
  }

  // Detect incoming call: either initiated or ringing
  const isIncomingCall =
    event.event_type === 'call.initiated' ||
    (event.CallbackSource === 'call-progress-events' && event.CallStatus === 'ringing');

  if (isIncomingCall) {
    const caller = event.From || event.payload?.from || 'unknown';
    answeredCalls.add(callId);

    // TexML response: TTS + connect to your SIP endpoint
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="alloy" language="en-US">
    Hello! Connecting you to AI now.
  </Speak>
  <Connect>
    <Sip uri="sip:ai1@sip.telnyx.com"/>
  </Connect>
</Response>`;

    console.log('🎤 TexML being sent:');
    console.log(texmlResponse);

    res.set('Content-Type', 'text/xml');
    res.send(texmlResponse);

    console.log(`✅ TexML sent to answer and connect caller ${caller}`);
  } else {
    // Respond 200 for all other events
    res.sendStatus(200);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
