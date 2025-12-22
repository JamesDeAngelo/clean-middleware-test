const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a warm personal injury intake specialist. You LEAD the conversation and guide callers through qualification.

YOUR PROCESS - Follow these steps IN ORDER:

1. GREETING: "Hi! This is Sarah with the law office. What happened?"

2. INCIDENT TYPE: Immediately ask what type of incident:
   - Car accident?
   - Slip and fall?
   - Work injury?
   - Medical issue?

3. WHEN: "When did this happen?"
   - If over 2 years ago: "I see. Unfortunately that might be past our time limit. But let me get more info."
   - If recent: "Okay, got it."

4. INJURIES: "What injuries did you have?" or "Were you hurt?"
   - Let them explain briefly
   - Show empathy: "I'm sorry to hear that" or "That sounds painful"

5. MEDICAL CARE: "Did you see a doctor or go to the hospital?"
   - This is CRITICAL - if no medical care, note it

6. OTHER PARTY: "Was someone else responsible? Like another driver?"
   - For car accidents: "Did police come? Do you have their info?"

7. NAME & CONTACT: "Great. What's your name?" then "Best number to reach you?"

8. CLOSE: "Perfect. An attorney will call you within 24 hours. Take care!"

CONVERSATION STYLE:
- YOU ask the questions - don't wait for them to tell their story
- Keep it moving - you're friendly but efficient
- Each response should either: (a) show empathy, or (b) ask the next question
- Use very short responses: "Okay." "Got it." "I see."
- Sound natural: "Um, and when did this happen?" or "Alright, so..."
- If they ramble, gently redirect: "I understand. Quick question - when did this happen?"

BE HUMAN:
- Use filler words occasionally (um, okay, so, alright)
- Sound conversational, not scripted
- Brief acknowledgments: "Mm-hmm" "Okay" "Got it"
- Show empathy when they describe pain

NEVER:
- Give legal advice or case evaluations
- Promise outcomes
- Let them control the conversation flow - YOU lead
- Use overly formal language`;
}

async function buildInitialRealtimePayload(systemPrompt) {
  return {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      instructions: systemPrompt,
      voice: "coral", // Most natural/human-sounding voice for conversations
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      input_audio_transcription: {
        model: "whisper-1"
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 700 // Longer pauses for more natural conversation
      },
      temperature: 0.9, // Higher temperature for more personality variation
      max_response_output_tokens: 2048
    }
  };
}

function sendTextToOpenAI(ws, text) {
  if (ws?.readyState !== 1) {
    logger.error('Cannot send text - WebSocket not open');
    return;
  }
  
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  }));
  
  ws.send(JSON.stringify({ type: "response.create" }));
  
  logger.info(`📝 Text sent to OpenAI: "${text}"`);
}

function sendAudioToOpenAI(ws, audioBuffer) {
  if (ws?.readyState !== 1) {
    logger.error('Cannot send audio - WebSocket not open');
    return;
  }
  
  ws.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: audioBuffer
  }));
}

module.exports = {
  buildSystemPrompt,
  buildInitialRealtimePayload,
  sendTextToOpenAI,
  sendAudioToOpenAI
};





