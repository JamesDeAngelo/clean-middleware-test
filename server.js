const express = require('express');
const app = express();

// Telnyx sends form data, NOT JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/texml-webhook', (req, res) => {
  console.log("📞 Incoming Webhook Body:");
  console.log(req.body);

  const texmlResponse = `
    <Response>
      <Speak voice="female" language="en-US">Hello, your AI is online.</Speak>
      <Pause length="5"/>
    </Response>
  `;

  res.set('Content-Type', 'application/xml');
  res.send(texmlResponse);
});

app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server running on port", process.env.PORT || 3000)
);
