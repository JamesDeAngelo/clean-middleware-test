import express from 'express';
import axios from 'axios';
import Airtable from 'airtable';

const app = express();
app.use(express.json());

const REQUIRED_FIELDS = [
  { key: 'accidentDate', question: 'What date was the accident?' },
  { key: 'location', question: 'Where did it happen? (city, state, road)' },
  { key: 'description', question: 'Can you describe what happened?' },
  { key: 'injuries', question: 'Were there any injuries?' },
  { key: 'fullName', question: 'What is your full name?' },
  { key: 'phoneNumber', question: 'What is the best phone number to reach you?' }
];

const FIELD_PROMPT = `You extract structured data from a truck accident intake call.
Given the transcript so far and ONLY the caller's latest answer, return JSON:
{"field_updates":{"fieldKey":"value"}, "needs_clarification":false}

Rules:
- fieldKey must be one of: accidentDate, location, description, injuries, fullName, phoneNumber.
- Include only keys clearly answered in the latest message.
- Same field can be updated multiple times (use the latest value).
- If the caller's answer is unclear/unrelated, set "needs_clarification":true.
- No explanations, just JSON.`;

// API clients
const telnyx = axios.create({
  baseURL: 'https://api.telnyx.com/v2',
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

const airtableBase =
  process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID
    ? new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)
    : null;

const sessions = new Map();

app.get('/', (_req, res) => res.send('Voice API agent running'));

app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body?.data;
  res.status(200).send('OK');

  if (!event) return;

  try {
    switch (event.event_type) {
      case 'call.initiated':
        await handleCallInitiated(event);
        break;
      case 'call.gather.ended':
        await handleGatherEnded(event);
        break;
      case 'call.hangup':
        await handleHangup(event);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message, err.response?.data);
  }
});

async function handleCallInitiated(event) {
  const { call_control_id: callControlId, call_session_id: sessionId, from } = event.payload;

  sessions.set(sessionId, {
    callControlId,
    phone: from,
    startTime: new Date().toISOString(),
    fields: {},
    history: []
  });

  await telnyx.post(`/calls/${callControlId}/actions/answer`);
  await speakAndListen(callControlId, "Hi, thanks for calling. I’ll grab a few quick details. What date was the accident?");
}

async function handleGatherEnded(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session) return;

  const transcript = event.payload.speech_result?.transcript?.trim();
  if (!transcript) {
    return speakAndListen(session.callControlId, "I didn't catch that. Could you say it again?");
  }

  session.history.push({ role: 'user', content: transcript });

  const update = await extractFields(session.history, transcript);
  if (!update) {
    return speakAndListen(session.callControlId, "Sorry, could you repeat that?");
  }

  if (update.field_updates) {
    for (const [key, value] of Object.entries(update.field_updates)) {
      session.fields[key] = value;
    }
  }

  const nextQuestion = update.needs_clarification
    ? "I’m sorry, I didn’t understand that. Could you clarify?"
    : getNextQuestion(session.fields);

  if (!nextQuestion) {
    await speak(session.callControlId, "Thanks for sharing those details. A truck accident attorney will contact you within 24 hours.");
    await wait(800);
    await telnyx.post(`/calls/${session.callControlId}/actions/hangup`);
    return;
  }

  session.history.push({ role: 'assistant', content: nextQuestion });
  await speakAndListen(session.callControlId, nextQuestion);
}

async function handleHangup(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session) return;

  if (airtableBase) {
    await saveToAirtable(session);
  }

  sessions.delete(sessionId);
}

function getNextQuestion(fields) {
  for (const field of REQUIRED_FIELDS) {
    if (!fields[field.key]) return field.question;
  }
  return null;
}

async function speakAndListen(callControlId, prompt) {
  await speak(callControlId, prompt);
  await wait(200);
  await startSpeechGather(callControlId);
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
  console.log('Starting gather for', callControlId);
  await telnyx.post(`/calls/${callControlId}/actions/gather_using_speech`, {
    language: 'en-US',
    interim_results: false,
    speech_timeout: 0.6,
    max_duration: 30,
    profanity_filter: true
  });
}

async function extractFields(history, latestAnswer) {
  const convo = history.map(m => `${m.role}: ${m.content}`).join('\n');

  try {
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'field_update',
            schema: {
              type: 'object',
              required: ['field_updates', 'needs_clarification'],
              properties: {
                field_updates: {
                  type: 'object',
                  additionalProperties: { type: 'string' }
                },
                needs_clarification: { type: 'boolean' }
              },
              additionalProperties: false
            }
          }
        },
        messages: [
          { role: 'system', content: FIELD_PROMPT },
          {
            role: 'user',
            content: `Conversation so far:\n${convo}\n\nLatest caller answer:\n${latestAnswer}`
          }
        ],
        max_tokens: 200,
        temperature: 0
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout: 12000
      }
    );

    return JSON.parse(data.choices?.[0]?.message?.content || '');
  } catch (err) {
    console.error('extractFields error:', err.message, err.response?.data);
    return null;
  }
}

async function saveToAirtable(session) {
  try {
    await airtableBase('Leads').create({
      'Phone Number': session.phone,
      'Call Start': session.startTime,
      'Accident Date': session.fields.accidentDate || '',
      'Location': session.fields.location || '',
      'Description': session.fields.description || '',
      'Injuries': session.fields.injuries || '',
      'Full Name': session.fields.fullName || '',
      'Phone Provided': session.fields.phoneNumber || '',
      Status: 'New',
      Qualified: 'Yes'
    });
  } catch (err) {
    console.error('Airtable error:', err.message, err.response?.data);
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice API agent listening on ${PORT}`);
  console.log('OpenAI key:', process.env.OPENAI_API_KEY ? 'set' : 'missing');
  console.log('Telnyx key:', process.env.TELNYX_API_KEY ? 'set' : 'missing');
  console.log('Airtable:', airtableBase ? 'enabled' : 'disabled');
});
