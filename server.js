const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch'); // npm install node-fetch@2

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// --- Debug logging for all requests ---
app.use((req, res, next) => {
  console.log('Incoming request:', req.method, req.url, req.body);
  next();
});

// --- TeXML webhook endpoint ---
app.post('/texml-webhook', (req, res) => {
  console.log('📞 TeXML Webhook Event:', req.body);

  // Basic TeXML response: answer the call, speak a message, then hang up
  const texmlResponse = `
    <Response>
      <Speak>Hi! This is your AI speaking.</Speak>
      <Hangup/>
    </Response>
  `;

  res.set('Content-Type', 'application/xml');
  res.send(texmlResponse);
});

// --- Optional: start outbound call endpoint ---
app.post('/start-call', async (req, res) => {
  try {
    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: process.env.SIP_ENDPOINT,       // Your TeXML SIP endpoint
        from: process.env.FROM_NUMBER,      // Your Telnyx number
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

// --- Start server ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
