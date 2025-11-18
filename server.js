const express = require('express');
const app = express();

// Middleware to parse JSON and XML
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));
app.use(express.urlencoded({ extended: true }));

// TeXML webhook endpoint
app.post('/texml-webhook', (req, res) => {
  try {
    console.log('📞 Incoming TeXML Webhook:', req.body);
    
    // TeXML response - this is XML that tells Telnyx what to do
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Hello! This is your A I assistant. If you can hear this message, your system is working correctly. How can I help you today?
  </Say>
  <Pause length="2"/>
  <Say voice="woman" language="en-US">
    Please tell me about your truck accident case.
  </Say>
  <Gather action="/gather-response" method="POST" timeout="5" finishOnKey="#">
    <Say voice="woman" language="en-US">
      Press any key when you're ready to speak, or just start talking.
    </Say>
  </Gather>
</Response>`;

    // Send TeXML response back to Telnyx
    res.type('application/xml');
    res.send(texmlResponse);
    
    console.log('✅ Sent TeXML response');
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Gather response endpoint (handles caller input)
app.post('/gather-response', (req, res) => {
  try {
    console.log('🎤 Caller input received:', req.body);
    
    const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-US">
    Thank you for your response. Let me connect you with someone who can help.
  </Say>
  <Hangup/>
</Response>`;

    res.type('application/xml');
    res.send(texmlResponse);
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send('Error');
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Telnyx TeXML server is running! ✅');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📞 TeXML webhook available at: /texml-webhook`);
});
