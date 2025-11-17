const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// --- TeXML webhook endpoint ---
app.post('/texml-webhook', (req, res) => {
  const eventType = req.body.CallbackSource || 'initial call';
  console.log(`📞 Event received: ${eventType}`);
  console.log(JSON.stringify(req.body, null, 2));

  // Basic TeXML response to answer the call and speak a message
  // Remove <Hangup/> to keep call active
  const texmlResponse = `
    <Response>
      <Speak>Hi! This is your AI speaking.</Speak>
      <Pause length="3"/>
      <Speak>How are you today?</Speak>
    </Response>
  `;

  res.set('Content-Type', 'application/xml');
  res.send(texmlResponse);
});

// --- Optional: start outbound call endpoint ---
app.post('/start-call', async (req, res) => {
  const fetch = (await import('node-fetch')).default;
  try {
    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: process.env.SIP_ENDPOINT,       // Your TeXML SIP endpoint
        from: process.env.FROM_NUMBER,      
        timeout_secs: 30,
        texml: {
          url: `${process.env.SERVER_BASE_URL}/texml-webhook` // URL returning TeXML
        }
      })
    });
    const data = await response.json();
    console.log('Outbound call started:', data);
    res.json(data);
  } catch (err) {
    console.error('Error starting outbound call:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
