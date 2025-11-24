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

const FIELD_PROMPT = `You are extracting details from a truck accident intake call.
Given the full transcript so far and the caller's latest answer, output JSON like:
{"field_updates":{"fieldKey":"value"}, "needs_clarification":false}

Rules:
- fieldKey must be one of: accidentDate, location, description, injuries, fullName, phoneNumber.
- Only set keys the caller clearly answered; leave others absent.
- Same key may be updated multiple times; store the freshest value.
- If the caller's answer was unclear or unrelated, set "needs_clarification":true, otherwise false.
Keep explanations out of the JSON.`;

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

app.get('/', (_, res) => res.send('Voice API agent running'));

app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body?.data;
  res.status(200).send('OK');

  if (!event) return;

  try {
    switch (event.event_type) {
      case 'call.initiated':
        await onCallInitiated(event);
        break;
      case 'call.speak.ended':
        await onSpeakEnded(event);
        break;
      case 'call.gather.ended':
        await onGatherEnded(event);
        break;
      case 'call.hangup':
        await onHangup(event);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Webhook error:', err.message, err.response?.data);
  }
});

async function onCallInitiated(event) {
  const { call_control_id: callControlId, call_session_id: sessionId, from } = event.payload;

  sessions.set(sessionId, {
    callControlId,
    phone: from,
    startTime: new Date().toISOString(),
    fields: {},
    history: [],
    gathering: false
  });

  await telnyx.post(`/calls/${callControlId}/actions/answer`);
  await speak(callControlId, "Hi, thanks for calling. I’ll gather a few quick details about your truck accident. What date was the accident?");
}

async function onSpeakEnded(event) {
  const session = sessions.get(event.payload.call_session_id);
  if (!session || session.gathering) return;
  session.gathering = true;
  await wait(200);
  await startSpeechGather(session.callControlId);
  session.gathering = false;
}

async function onGatherEnded(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session) return;

  const transcript = event.payload.speech_result?.transcript?.trim();
  if (!transcript) {
    await speak(session.callControlId, "I didn't catch that. Could you say it again?");
    await wait(200);
    return startSpeechGather(session.callControlId);
  }

  session.history.push({ role: 'user', content: transcript });

  const update = await extractFields(session.history, transcript);
  if (!update) {
    await speak(session.callControlId, "Sorry, could you repeat that?");
    await wait(200);
    return startSpeechGather(session.callControlId);
  }

  if (update.field_updates) {
    Object.entries(update.field_updates).forEach(([key, value]) => {
      session.fields[key] = value;
    });
  }

  let nextQuestion;
  if (update.needs_clarification) {
    nextQuestion = "I’m sorry, I didn’t understand that. Could you clarify?";
  } else {
    nextQuestion = getNextQuestion(session.fields);
  }

  if (!nextQuestion) {
    await speak(
      session.callControlId,
      "Thank you for sharing those details. A truck accident attorney will contact you within 24 hours."
    );
    await wait(800);
    await telnyx.post(`/calls/${session.callControlId}/actions/hangup`);
    return;
  }

  session.history.push({ role: 'assistant', content: nextQuestion });
  await speak(session.callControlId, nextQuestion);
}

async function onHangup(event) {
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

async function extractFields(history, lastAnswer) {
  const messages = [
    { role: 'system', content: FIELD_PROMPT },
    { role: 'user', content: `Conversation so far:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nLatest answer: "${lastAnswer}"` }
  ];

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
        messages,
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
  console.log('Gather started');
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
