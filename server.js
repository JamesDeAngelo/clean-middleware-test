require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const Airtable = require("airtable");

const app = express();
app.use(express.json());
app.use(bodyParser.json({ limit: "1mb" }));

// ===== Root Route =====
app.get("/", (req, res) => res.send("✅ Server is alive and working!"));

// ===== Telnyx Webhook =====
app.post("/telnyx-webhook", async (req, res) => {
  console.log("📞 Telnyx Webhook Event:", JSON.stringify(req.body, null, 2));
  res.status(200).send("Webhook received");

  const event = req.body?.data?.event_type;
  if (event === "call.initiated") {
    const callControlId = req.body.data.payload.call_control_id;

    try {
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
        {
          text: "Hello! Thanks for calling. We'll get started shortly.",
          voice: "alloy",
          language: "en-US",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("🎤 TTS message sent to caller");
    } catch (err) {
      console.error("❌ Error sending TTS:", err.response?.data || err.message);
    }
  }
});

// ===== Airtable Setup =====
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);
const TABLE = process.env.AIRTABLE_TABLE_NAME || "Lead Contacts";

const ALLOWED_FIELDS = [
  "Name",
  "Phone Number",
  "Date of Accident",
  "Location of Accident",
  "Type of Truck",
  "Injuries Sustained",
  "Police Report Filed",
  "Raw Transcript (Input)",
];

function buildAirtableFields(payload = {}) {
  const out = {};
  const get = (key) => {
    if (payload[key]) return payload[key];
    const lower = key.toLowerCase();
    return (
      payload[lower] ??
      payload[lower.replace(/\s+/g, "_")] ??
      payload[lower.replace(/\s+/g, "")]
    );
  };

  for (const field of ALLOWED_FIELDS) {
    const val = get(field);
    if (val !== undefined && val !== null) {
      out[field] =
        field === "Raw Transcript (Input)" && typeof val !== "string"
          ? JSON.stringify(val)
          : String(val);
    }
  }
  return out;
}

// ===== Voiceflow → Airtable Intake =====
app.post("/webhook/intake", async (req, res) => {
  try {
    const p = req.body || {};
    const mapping = {
      Name: p.name,
      "Phone Number": p.phone,
      "Date of Accident": p.dateOfAccident,
      "Location of Accident": p.locationOfAccident,
      "Type of Truck": p.truckType,
      "Injuries Sustained": p.injuries,
      "Police Report Filed": p.policeReport,
      "Raw Transcript (Input)": p.rawTranscript,
    };

    const fields = buildAirtableFields(mapping);
    if (!fields["Name"] && !fields["Phone Number"]) {
      return res.status(400).json({ success: false, error: "missing_name_and_phone" });
    }

    const created = await base(TABLE).create([{ fields }]);
    console.log("✅ Airtable record created:", created[0].id);
    res.status(200).json({ success: true, id: created[0].id });
  } catch (err) {
    console.error("❌ Airtable insert error:", err);
    res.status(500).json({ success: false, error: err.message || err });
  }
});

// ===== Voiceflow API Bridge =====
app.post("/voiceflow", async (req, res) => {
  try {
    const { message, userId = "test-user" } = req.body;
    if (!message) return res.status(400).json({ error: "Missing 'message'" });

    const vfRes = await axios.post(
      `https://general-runtime.voiceflow.com/state/user/${userId}/interact`,
      [{ type: "text", payload: message }],
      {
        headers: {
          Authorization: process.env.VOICEFLOW_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(vfRes.data);
  } catch (err) {
    console.error("❌ Voiceflow API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Voiceflow API error", details: err.message });
  }
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
