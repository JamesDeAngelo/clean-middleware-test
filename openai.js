const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY in environment variables');
}

async function buildSystemPrompt() {
  logger.info('Building system prompt');
  return `You are a friendly, professional lawyer intake assistant. Your role is to gather client information efficiently, politely, and clearly during phone calls.

Your responsibilities:
- Introduce yourself politely at the start of the call
- Ask questions step-by-step to collect necessary intake information
- Confirm information back to the caller to ensure accuracy
- Handle interruptions gracefully and guide the conversation back on track
- Use natural-sounding phrasing with short, clear sentences

Tone and style:
- Speak in a calm, clear, human-like tone
- Be warm but professional
- Keep responses concise and actionable
- Use conversational language suitable for text-to-speech

Important constraints:
- NEVER give legal advice
- Only collect intake information
- Do not ask for unnecessary details
- Always remain polite and professional
- If asked for legal advice, politely explain that you can only gather information and a lawyer will follow up

Input/Output format:
- You will receive telephony audio or text from the caller via WebSocket
- Respond with plain text that will be converted to speech
- Keep responses brief and natural for phone conversation`;
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
      tools: [],
      tool_choice: "auto",
      temperature: 0.8
    }
  };
}

function sendTextToOpenAI(ws, text) {
  try {
    if (!ws || ws.readyState !== 1) {
      logger.error('WebSocket is not open, cannot send text');
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
    logger.error(`Failed to send text to OpenAI: ${error.message}`);
  }
}

function sendAudioToOpenAI(ws, audioBuffer) {
  try {
    if (!ws || ws.readyState !== 1) {
      logger.error('WebSocket is not open, cannot send audio');
      return;
    }
    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioBuffer
      })
    );
    logger.info('Audio chunk sent to OpenAI');
  } catch (error) {
    logger.error(`Failed to send audio to OpenAI: ${error.message}`);
  }
}

module.exports = {
  buildSystemPrompt,
  buildInitialRealtimePayload,
  sendTextToOpenAI,
  sendAudioToOpenAI
};