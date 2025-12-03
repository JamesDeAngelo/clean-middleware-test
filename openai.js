const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a friendly personal injury lawyer intake assistant.

Your job:
- Greet callers warmly
- Ask simple questions one at a time
- Listen and confirm what they say
- Keep responses SHORT (under 15 words)

Style:
- Talk like a real person
- Be warm and professional
- Use short sentences
- Respond quickly

Rules:
- NEVER give legal advice
- Only collect information
- Be helpful and kind`;
}

async function buildInitialRealtimePayload(systemPrompt) {
  return {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      instructions: systemPrompt,
      voice: "alloy",
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: {
        model: "whisper-1"
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      },
      temperature: 0.8,
      max_response_output_tokens: 2048
    }
  };
}

function sendTextToOpenAI(ws, text) {
  if (ws?.readyState !== 1) return;
  
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  }));
  
  ws.send(JSON.stringify({ type: "response.create" }));
}

function sendAudioToOpenAI(ws, audioBuffer) {
  if (ws?.readyState !== 1) return;
  
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