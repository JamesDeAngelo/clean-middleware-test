const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY in environment variables');
}

async function buildSystemPrompt() {
  logger.info('Building system prompt');
  return `You are Sarah, a friendly and professional personal injury lawyer intake assistant. Your role is to gather client information efficiently during phone calls.

Your responsibilities:
- Greet callers warmly and introduce yourself
- Ask questions one at a time to collect intake information
- Listen carefully and confirm information back
- Keep responses brief and conversational
- Guide the conversation naturally

Tone and style:
- Speak naturally like a real receptionist
- Use short, clear sentences (under 20 words)
- Be warm, empathetic, and professional
- Respond promptly

Important constraints:
- NEVER give legal advice
- Only collect intake information
- If asked for legal advice, say an attorney will follow up

Keep responses brief for natural phone conversation.`;
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
        silence_duration_ms: 700
      },
      tools: [],
      tool_choice: "auto",
      temperature: 0.8,
      max_response_output_tokens: 4096
    }
  };
}

function sendTextToOpenAI(ws, text) {
  try {
    if (!ws || ws.readyState !== 1) {
      logger.error('WebSocket is not open');
      return;
    }
    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }]
        }
      })
    );
    ws.send(JSON.stringify({ type: "response.create" }));
    logger.info('User text sent to OpenAI');
  } catch (error) {
    logger.error(`Failed to send text: ${error.message}`);
  }
}

function sendAudioToOpenAI(ws, audioBuffer) {
  try {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    
    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioBuffer
      })
    );
    
  } catch (error) {
    logger.error(`Failed to send audio: ${error.message}`);
  }
}

module.exports = {
  buildSystemPrompt,
  buildInitialRealtimePayload,
  sendTextToOpenAI,
  sendAudioToOpenAI
};