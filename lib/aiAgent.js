const WebSocket = require('ws');
const axios = require('axios');
const Airtable = require('airtable');

/**
 * Starts a real-time AI session for a Telnyx call
 * @param {Object} telnyxPayload - the incoming call payload from Telnyx
 * @param {Object} lawyerConfig - configuration for the specific Telnyx number
 */
async function startRealtimeSession(telnyxPayload, lawyerConfig) {
  console.log("==== Starting real-time AI session ====");
  console.log("TELNYX PAYLOAD:", JSON.stringify(telnyxPayload, null, 2));

  // ------------------------------
  // Airtable setup
  // ------------------------------
  const base = new Airtable({ apiKey: lawyerConfig.airtableKey }).base(lawyerConfig.baseId);

  // Save lead to Airtable with correct field names
  try {
    await base(lawyerConfig.table).create([
      {
        fields: {
          "Name": "Test Call",
          "Phone Number": telnyxPayload.data?.payload?.from || "Unknown",
          "Date of Accident": "",            // optional placeholder
          "Location of Accident": "",
          "Type of Truck": "",
          "Injuries Sustained": "",
          "Police Report Field": "",
          "Call Timestamp": new Date().toISOString(),
          "Raw Transcript": "",
          "Raw Transcript (Input)": "",
          "Qualified?": false
        }
      }
    ]);
    console.log("✅ Lead saved to Airtable");
  } catch (error) {
    console.error("❌ Airtable error:", error);
  }

  // ------------------------------
  // POST to global webhook
  // ------------------------------
  try {
    await axios.post(process.env.GLOBAL_WEBHOOK_URL || "https://webhook.site/placeholder", {
      type: 'lead',
      format: 'clean',
      data: {
        summary: 'AI call initiated',
        lead: {
          name: 'Test Call',
          phone: telnyxPayload.data?.payload?.from || 'Unknown'
        },
        transcript: null,
        extras: {}
      }
    });
    console.log("✅ Posted to global webhook");
  } catch (error) {
    console.error("❌ Webhook error:", error);
  }

  // ------------------------------
  // OpenAI Realtime WebSocket
  // ------------------------------
  const wsUrl = `${process.env.OPENAI_REALTIME_URL}?model=gpt-4o-realtime-preview-2024-12-17`;

  const ws = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  ws.on('open', () => {
    console.log("✅ Connected to OpenAI Realtime API");
  });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log("OpenAI message type:", data.type);

      // Handle AI audio output (to be wired to Telnyx later)
      if (data.type === 'response.audio.delta') {
        console.log("🎧 Received audio chunk from AI");
      }

      // Handle transcription results
      if (data.type === 'conversation.item.input_audio_transcription.completed') {
        console.log("📝 Transcript:", data.transcript);
      }
    } catch (err) {
      console.error("Error parsing OpenAI message:", err, msg);
    }
  });

  ws.on('close', () => console.log("⚠️ OpenAI WebSocket closed"));
  ws.on('error', (err) => console.error("❌ OpenAI WebSocket error:", err));

  console.log("==== AI session setup complete ====");
}

module.exports = { startRealtimeSession };
