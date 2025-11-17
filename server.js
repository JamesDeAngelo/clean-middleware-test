// server.js
const express = require('express');
const app = express();

app.use(express.json());

app.post('/texml-webhook', (req, res) => {
  const event = req.body.CallbackSource || 'initial';
  console.log(`📞 Event received: ${event}`);
  console.log(JSON.stringify(req.body, null, 2));

  const texmlResponse = `
    <Response>
      <Speak>Hi! This is your AI speaking. Welcome to your call.</Speak>
      <Pause length="10"/>
    </Response>
  `;

  res.set('Content-Type', 'application/xml');
  res.send(texmlResponse);
});

// Render listens on process.env.PORT
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running on port", process.env.PORT || 3000);
});
