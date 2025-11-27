const WebSocket = require('ws');
const axios = require('axios');
const Airtable = require('airtable');

async function startRealtimeSession(telnyxPayload, lawyerConfig) {
  console.log('Starting real-time session for:', telnyxPayload.data?.payload?.to);

  // Airtable setup
  const base = new Airtable({ apiKey: lawyerConfig.airtableKey }).base(lawyerConfig.baseId);

  // OpenAI Realtime WebSocket
  const wsUrl = `${process.env.OPENAI_REALTIME_URL}?model=gpt-4o-realtime-preview-2024-12-17`;
  
  const ws = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  ws.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
  });

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    console.log('OpenAI message type:', data.type);

    // Handle audio output from OpenAI
    if (data.type === 'response.audio.delta') {
      console.log('Received audio chunk from AI');
      // TODO: Forward to Telnyx
    }

    if (data.type === 'conversation.item.input_audio_transcription.completed') {
      console.log('Transcript:', data.transcript);
    }
  });

  ws.on('close', () => console.log('OpenAI WebSocket closed'));
  ws.on('error', (err) => console.error('OpenAI WebSocket error:', err));

  // Save lead to Airtable (placeholder for now)
  try {
    await base(lawyerConfig.table).create([
      { 
        fields: { 
          Name: 'Test Call',
          Phone: telnyxPayload.data?.payload?.from || 'Unknown',
          Summary: 'AI call initiated'
        }
      }
    ]);
    console.log('Lead saved to Airtable');
  } catch (error) {
    console.error('Airtable error:', error);
  }

  // POST to global webhook
  try {
    await axios.post(process.env.GLOBAL_WEBHOOK_URL, {
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
    console.log('Posted to global webhook');
  } catch (error) {
    console.error('Webhook error:', error);
  }
}

module.exports = { startRealtimeSession };