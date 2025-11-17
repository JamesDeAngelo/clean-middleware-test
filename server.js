// server.js
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Telnyx sends JSON for Voice API
app.post('/telnyx-webhook', async (req, res) => {
  const data = req.body.data;
  console.log("📞 Incoming:", JSON.stringify(data, null, 2));

  // Telnyx event type
  const eventType = data.event_type;

  // Each call has a unique call_control_id
  const callControlId = data.payload.call_control_id;

  // 1️⃣ The moment the call is answered ("call.answered") → speak
  if (eventType === "call.answered") {
    console.log("☎️ Call answered — sending Speak command...");

    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
      {
        payload: "Hello. Your AI is now online."
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.sendStatus(200);
  }

  // 2️⃣ If call is incoming but not answered yet
  if (eventType === "call.initiated") {
    console.log("☎️ Call initiated — answering...");

    await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
      {},
      {
        headers: {
          "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.sendStatus(200);
  }

  // Default response
  return res.sendStatus(200);
});

// Start server
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running on port", process.env.PORT || 3000);
});
