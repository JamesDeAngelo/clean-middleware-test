import express from 'express';
import axios from 'axios';
import Airtable from 'airtable';

const app = express();
app.use(express.json());

const SYSTEM_PROMPT = `You are an AI legal intake assistant for truck accident cases.
Always respond with valid JSON exactly like:
{"assistant_reply":"<spoken response>","is_complete":false}
Workflow:
1. Ask (in order) date of accident, location (city/state/road), description, injuries, full name, phone number.
2. Use 1-2 conversational, empathetic sentences.
3. Skip any question the caller already answered.
4. Only when ALL six data points are confirmed set "is_complete":true and give a warm wrap‑up message. Otherwise leave it false.`;

// Telnyx client
const telnyx = axios.create({
  baseURL: 'https://api.telnyx.com/v2',
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

// Airtable setup
const airtableBase =
  process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID
    ? new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)
    : null;

// Conversation store
const sessions = new Map();

app.get('/', (_req, res) => res.send('Voice API agent running'));

app.post('/telnyx-webhook', async (req, res) => {
  const event = req.body?.data;
  const type = event?.event_type;
  res.status(200).send('OK'); // acknowledge immediately

  if (!event) return;

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
    console.error('Webhook error:', err.message, err.response?.data);
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
        content:
          "Hi, thanks for calling. I'm here to help log your truck accident case. Can you tell me the date of the accident?"
      }
    ],
    startTime: new Date().toISOString(),
    gathering: false
  });

  await telnyx.post(`/calls/${callControlId}/actions/answer`);
  await speak(callControlId, sessions.get(sessionId).history.at(-1).content);
  // gather starts after speak.ended
}

async function maybeStartGather(event) {
  const session = sessions.get(event.payload.call_session_id);
  if (!session || session.gathering) return;

  session.gathering = true;
  await wait(200); // ensure playback fully stops
  await startSpeechGather(session.callControlId);
  session.gathering = false;
}

async function handleGatherResult(event) {
  const sessionId = event.payload.call_session_id;
  const session = sessions.get(sessionId);
  if (!session) return;

  const transcript = event.payload.speech_result?.transcript?.trim();
  if (!transcript) {
    await speak(session.callControlId, "I didn't catch that. Could you please say it again?");
    await wait(200);
    return startSpeechGather(session.callControlId);
  }

  session.history.push({ role: 'user', content: transcript });

  const agentTurn = await getAgentTurn(session.history);
  if (!agentTurn) {
    await speak(session.callControlId, "I'm sorry, could you repeat that?");
    await wait(200);
    return startSpeechGather(session.callControlId);
  }

  session.history.push({ role: 'assistant', content: agentTurn.assistant_reply });
  await speak(session.callControlId, agentTurn.assistant_reply);

  if (agentTurn.is_complete === true) {
    await wait(800);
    await telnyx.post(`/calls/${session.callControlId}/actions/hangup`);
  } else {
    await wait(200);
    await startSpeechGather(session.callControlId);
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

    try {
      await airtableBase('Leads').create({
        'Phone Number': session.phone,
        'Call Start': session.startTime,
        'Full Transcript': transcript,
        Status: 'New',
        Qualified: 'Yes'
      });
    } catch (err) {
      console.error('Airtable error:', err.message, err.response?.data);
    }
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
    speech_timeout: 0.6, // seconds of silence before stopping
    max_duration: 30,
    profanity_filter: true
  });
  console.log('Speech gather started');
}

async function getAgentTurn(history) {
  try {
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'intake_turn',
            schema: {
              type: 'object',
              required: ['assistant_reply', 'is_complete'],
              properties: {
                assistant_reply: { type: 'string' },
                is_complete: { type: 'boolean' }
              },
              additionalProperties: false
            }
          }
        },
        messages: history,
        max_tokens: 180,
        temperature: 0.5
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout: 12000
      }
    );

    return JSON.parse(data.choices?.[0]?.message?.content || '');
  } catch (err) {
    console.error('GPT turn error:', err.message, err.response?.data);
    return null;
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Voice API agent started on', PORT);
  console.log('OpenAI key:', process.env.OPENAI_API_KEY ? 'set' : 'missing');
  console.log('Telnyx key:', process.env.TELNYX_API_KEY ? 'set' : 'missing');
  console.log('Airtable:', airtableBase ? 'enabled' : 'disabled');
});
