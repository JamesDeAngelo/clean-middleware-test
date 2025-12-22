const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI
} = require('./openai');

const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

async function connectToOpenAI(callId) {
  return new Promise(async (resolve, reject) => {
    try {
      const ws = new WebSocket(OPENAI_URL, {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      let audioChunksSent = 0;
      let currentAssistantMessage = "";

      ws.on('open', async () => {
        logger.info('✓ OpenAI connected');
        
        const systemPrompt = await buildSystemPrompt();
        const initPayload = await buildInitialRealtimePayload(systemPrompt);
        
        ws.send(JSON.stringify(initPayload));
        
        sessionStore.createSession(callId, ws);
        
        resolve(ws);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Handle audio from OpenAI
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            
            if (!session || !session.streamConnection || session.streamConnection.readyState !== 1) {
              return;
            }
            
            const audioPayload = {
              event: 'media',
              stream_sid: session.streamSid,
              media: {
                track: 'outbound',
                payload: msg.delta
              }
            };
            
            session.streamConnection.send(JSON.stringify(audioPayload));
            audioChunksSent++;
            
            if (audioChunksSent % 20 === 0) {
              logger.info(`📤 ${audioChunksSent} chunks sent`);
            }
          }

          // Track AI transcript
          if (msg.type === "response.audio_transcript.delta") {
            currentAssistantMessage += msg.delta;
          }

          if (msg.type === "response.audio_transcript.done") {
            if (currentAssistantMessage.trim()) {
              const message = currentAssistantMessage.trim();
              sessionStore.addAssistantTranscript(callId, message);
              
              // Check if conversation is ending
              const isEnding = message.toLowerCase().includes("take care") || 
                              message.toLowerCase().includes("call you within") ||
                              message.toLowerCase().includes("attorney will call");
              
              if (isEnding) {
                logger.info(`🎬 Conversation ending detected`);
                const session = sessionStore.getSession(callId);
                if (session) {
                  session.conversationComplete = true;
                  sessionStore.updateSession(callId, session);
                }
              }
              
              currentAssistantMessage = "";
            }
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
          }

          // Track user transcript
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            if (msg.transcript && msg.transcript.trim()) {
              sessionStore.addUserTranscript(callId, msg.transcript.trim());
            }
          }

          if (msg.type === "response.done") {
            logger.info(`✓ Response complete (${audioChunksSent} chunks)`);
            audioChunksSent = 0;
          }

          if (msg.type === "error") {
            logger.error(`❌ OpenAI error: ${JSON.stringify(msg.error)}`);
          }

          if (msg.type === "session.created") {
            logger.info('✓ OpenAI session ready');
            setTimeout(() => {
              triggerGreeting(ws);
            }, 500);
          }
          
          if (msg.type === "session.updated") {
            logger.info(`✓ Session updated`);
          }

        } catch (err) {
          logger.error(`Parse error: ${err.message}`);
        }
      });

      ws.on('error', (err) => {
        logger.error(`OpenAI error: ${err.message}`);
        reject(err);
      });

      ws.on('close', () => {
        logger.info('OpenAI closed');
      });

    } catch (error) {
      logger.error(`Connect failed: ${error.message}`);
      reject(error);
    }
  });
}

function triggerGreeting(ws) {
  if (ws?.readyState !== 1) {
    return;
  }
  
  ws.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["text", "audio"],
      instructions: "Say: Hi! This is Sarah from the law office. What happened?"
    }
  }));
  
  logger.info('🎙️ Greeting triggered');
}

function attachTelnyxStream(callId, telnyxWs, streamSid) {
  const session = sessionStore.getSession(callId);
  
  if (!session) {
    logger.error(`❌ No session for: ${callId}`);
    return;
  }
  
  session.streamConnection = telnyxWs;
  session.streamSid = streamSid;
  sessionStore.updateSession(callId, session);
  logger.info(`✓ Stream attached`);
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);
  
  if (!session || !session.ws || session.ws.readyState !== 1) {
    return;
  }
  
  sendAudioToOpenAI(session.ws, audioBuffer);
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI
};






