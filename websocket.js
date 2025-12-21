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
      let questionsAsked = 0; // CRITICAL: Track how many questions have been asked
      let greetingTriggered = false; // Prevent double greeting

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
              
              // CRITICAL: Count questions asked by checking for question marks or key phrases
              const lowerMessage = message.toLowerCase();
              if (lowerMessage.includes('?') || 
                  lowerMessage.includes('were you the person') ||
                  lowerMessage.includes('commercial truck') ||
                  lowerMessage.includes('see a doctor') ||
                  lowerMessage.includes('go to the hospital') ||
                  lowerMessage.includes('when did') ||
                  lowerMessage.includes('where did') ||
                  lowerMessage.includes('what injuries') ||
                  lowerMessage.includes('police') ||
                  lowerMessage.includes('your name') ||
                  lowerMessage.includes('what happened') ||
                  lowerMessage.includes('how can i help') ||
                  lowerMessage.includes('phone number') ||
                  lowerMessage.includes('number to reach')) {
                questionsAsked++;
                logger.info(`📊 Questions asked so far: ${questionsAsked}/10`);
              }
              
              // Check if conversation is ending
              const isEnding = message.toLowerCase().includes("take care") || 
                              message.toLowerCase().includes("call you within") ||
                              message.toLowerCase().includes("attorney will call");
              
              if (isEnding) {
                logger.info(`🎬 Conversation ending detected - marking complete`);
                const session = sessionStore.getSession(callId);
                if (session) {
                  session.conversationComplete = true;
                  sessionStore.updateSession(callId, session);
                }
              }
              
              // CRITICAL FALLBACK: If at least 3 questions were asked, consider it substantial enough to save
              // Lowered from 6 to 3 to capture early hangups
              if (questionsAsked >= 3) {
                logger.info(`✅ Substantial conversation (${questionsAsked} questions) - will save if call ends`);
                const session = sessionStore.getSession(callId);
                if (session) {
                  session.conversationSubstantial = true;
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
            // Don't trigger here - wait for session.updated
          }
          
          if (msg.type === "session.updated") {
            logger.info(`✓ Session configured - triggering greeting`);
            if (!greetingTriggered) {
              greetingTriggered = true;
              setTimeout(() => {
                triggerGreeting(ws);
              }, 500);
            }
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
    logger.error('Cannot trigger greeting - WebSocket not open');
    return;
  }
  
  // Just trigger a response without instructions - let the system prompt handle it
  ws.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["text", "audio"]
    }
  }));
  
  logger.info('📞 Greeting triggered');
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