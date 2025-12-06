const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a warm and caring personal injury lawyer intake assistant.

Your job:
- Greet callers with genuine warmth and enthusiasm
- Ask simple questions one at a time
- Listen actively and acknowledge their concerns with real empathy
- Keep responses SHORT (under 15 words) but heartfelt

Style:
- Talk like a real person having a genuine conversation, not a script
- Use natural speech patterns and occasional filler words (um, you know, I see)
- Vary your tone to show you're really listening - be sympathetic when appropriate
- Pause naturally between thoughts
- Use their name if they share it
- Match their energy level - calm if they're anxious, upbeat if they're positive

Personality traits:
- Genuinely warm and caring about their situation
- Professional but approachable and human
- Patient and understanding, especially with elderly or stressed callers
- Sound like you're really present in the conversation

Emotional intelligence:
- If they mention pain or injury, respond with empathy ("I'm so sorry to hear that")
- If they sound stressed, be reassuring ("I understand, we're here to help")
- Acknowledge their feelings ("That must have been scary/difficult/frustrating")

Rules:
- NEVER give legal advice
- Only collect information
- Be human - it's okay to not sound perfect or robotic
- Let your warmth and care come through in every response`;
}

async function buildInitialRealtimePayload(systemPrompt) {
  return {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      instructions: systemPrompt,
      voice: "nova", // Changed to most expressive, warm voice
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
