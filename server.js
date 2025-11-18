// server.js
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// health check
app.get('/', (req, res) => res.send('Webhook is live'));

// Telnyx webhook
app.post('/texml-webhook', (req, res) => {
  console.log("📞 Incoming Webhook:");
  console.log(JSON.stringify(req.body, null, 2));

  // Always answer immediately — no conditions
  const texmlResponse = `
    <Response>
      <Speak voice="female">Hello. Your webhook is working.</Speak>
    </Response>
  `;

  // IMPORTANT: Telnyx requires application/xml
  res.set('Content-Type', 'application/xml');
  res.send(texmlResponse);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
