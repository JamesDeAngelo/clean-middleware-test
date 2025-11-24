// server.js
import express from 'express';
import axios from 'axios';
import Airtable from 'airtable';

const app = express();
app.use(express.json());

const SYSTEM_PROMPT = `You are an AI legal intake assistant for truck accident cases.
Ask, in order:
1. Date of the accident
2. Location (city, state, road)
3. Description of what happened
4. Were there injuries?
5. Their full name
6. Their phone number
RULES:
- Keep responses SHORT (1-2 sentences max)
- Be conversational and empathetic
- If they already gave info, skip the question
- When you have all 6 pieces, respond with exactly: "CONVERSATION_COMPLETE"`;

const telnyx = axios.create({
  baseURL: 'https://api.telnyx.com/v2',
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

const airtableBase = process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID
  ? new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)
  : null;

const sessions = new Map();

app.get('/', (_, res) => res.send('Voice API Agent running'));

app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body?.data;
  const type = event?.event_type;
  res.status(200).send('OK'); // respond quickly so Telnyx doesn’t retry

  try {
    switch (type) {
      case 'call.initiated':
        await handleCallInitiated(event);
        break;
      case 'call.speak.ended':
        await maybeStartGather(event);
        break;
      case 'call.gather.ended':
        await handleGatherResult(event);
        break;
      case 'call.hangup':
        await finalizeConversation(event);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handling error:', err.message, err.response?.data);
  }
});

async function handleCallInitiated(event) {
  const { call_control_id: callControlId, call_session_id: sessionId, from } = event.payload;

  sessions.set(sessionId, {
    callControlId,
    phone: from,
    history: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'assistant',
        content: "Hi, thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?"
      }
    ],
    startTime: new Date().toISOString(),
    nextGatherPending: false
  });

  await telnyx.post(`/calls/${callControlId}/actions/answer`);
  await speak(callControlId, sessions.get(sessionId).history.at(-1).content);
  // gather starts after `call.speak.ended`
}

async function maybeStartGather(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session || session.nextGatherPending) return;

  session.nextGatherPending = true;
  // give Telnyx 200ms so audio playback fully stops
  await wait(200);
  await startSpeechGather(session.callControlId);
  session.nextGatherPending = false;
}

async function handleGatherResult(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session) return;

  const transcript =
    event.payload.speech_result?.transcript ||
    event.payload.recordings?.[0]?.transcription ||
    '';

  if (!transcript.trim()) {
    await speak(session.callControlId, "I didn't catch that. Could you please say it again?");
    await wait(250);
    return startSpeechGather(session.callControlId);
  }

  session.history.push({ role: 'user', content: transcript });

  const reply = await getGPTResponse(session.history);
  session.history.push({ role: 'assistant', content: reply });

  if (reply.includes('CONVERSATION_COMPLETE')) {
    await speak(session.callControlId, "Thank you! A truck accident attorney will contact you within 24 hours.");
    await wait(800);
    await telnyx.post(`/calls/${session.callControlId}/actions/hangup`);
  } else {
    await speak(session.callControlId, reply);
    // gather auto-starts on speak.ended
  }
}

async function finalizeConversation(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session) return;

  if (airtableBase) {
    const transcript = session.history
      .filter(msg => msg.role !== 'system')
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    await airtableBase('Leads').create({
      'Phone Number': session.phone,
      'Call Start': session.startTime,
      'Full Transcript': transcript,
      Status: 'New',
      Qualified: 'Yes'
    });
  }

  sessions.delete(sessionId);
}

async function speak(callControlId, text) {
  await telnyx.post(`/calls/${callControlId}/actions/speak`, {
    payload: text,
    voice: 'female',
    language: 'en-US'
  });
  console.log('Speaking:', text);
}

async function startSpeechGather(callControlId) {
  await telnyx.post(`/calls/${callControlId}/actions/gather_using_speech`, {
    language: 'en-US',
    interim_results: false,
    speech_timeout: 0.6,
    max_duration: 30,
    profanity_filter: true
  });
  console.log('Speech gather started');
}

async function getGPTResponse(history) {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', messages: history, max_tokens: 120, temperature: 0.6 },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 12000 }
  );
  return data.choices?.[0]?.message?.content?.trim() || "I'm sorry, could you say that again?";
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Voice API agent ready on ${PORT}`));
