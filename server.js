const express = require('express');
const app = express();

// Telnyx sends form-encoded data first, JSON sometimes later
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/texml-webhook', (req, res) => {
  console.log("📞 Incoming Webhook Body:");
  console.log(req.body);

  const texml = `
    <Response>
      <Speak voice="female" language="en-US">
        Hello. This is your AI. The webhook works.
      </Speak>
      <Pause length="3"/>
    </Response>
  `;

  // ❗ Telnyx requires text/xml or it ignores the response
  res.set('Content-Type', 'text/xml');
  res.send(texml);
});

app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server running on port", process.env.PORT || 3000)
);
