const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendOpeningGreeting,
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
      let audioChunksReceived = 0;

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
              logger.info(`📤 ${audioChunksSent} chunks sent to caller`);
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
              const transcript = msg.transcript.trim();
              
              // FILTER OUT ECHOES - Don't save if it sounds like the AI
              const isLikelyEcho = 
                transcript.toLowerCase().includes("did you") ||
                transcript.toLowerCase().includes("were you") ||
                transcript.toLowerCase().includes("what city") ||
                transcript.toLowerCase().includes("law office") ||
                transcript.toLowerCase().includes("this is sarah");
              
              if (!isLikelyEcho) {
                sessionStore.addUserTranscript(callId, transcript);
              } else {
                logger.warn(`⚠️ Filtered echo: "${transcript}"`);
              }
            }
          }

          if (msg.type === "response.done") {
            logger.info(`✓ Response complete (${audioChunksSent} chunks)`);
            audioChunksSent = 0;
          }

          if (msg.type === "error") {
            logger.error(`❌ OpenAI error: ${JSON.stringify(msg.error)}`);
          }

          if (msg.type === "session.updated") {
            logger.info('✓ Session configured - waiting for stream');
            // Mark that session is ready
            const session = sessionStore.getSession(callId);
            if (session) {
              session.sessionReady = true;
              sessionStore.updateSession(callId, session);
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
  
  // NOW trigger greeting after stream is fully connected
  if (session.sessionReady && !session.greetingSent) {
    logger.info('🎤 Stream ready - triggering greeting in 1.5 seconds...');
    
    // Wait 1.5 seconds (reduced from 2 seconds for faster response)
    setTimeout(() => {
      const currentSession = sessionStore.getSession(callId);
      if (currentSession && currentSession.ws && !currentSession.greetingSent) {
        // Clear any audio buffer before greeting
        currentSession.ws.send(JSON.stringify({
          type: "input_audio_buffer.clear"
        }));
        
        logger.info('🧹 Audio buffer cleared');
        
        // Wait 200ms after clearing buffer, then send greeting
        setTimeout(() => {
          const finalSession = sessionStore.getSession(callId);
          if (finalSession && finalSession.ws) {
            sendOpeningGreeting(finalSession.ws);
            finalSession.greetingSent = true;
            sessionStore.updateSession(callId, finalSession);
          }
        }, 200);
      }
    }, 1500);  // Reduced from 2000ms to 1500ms
  }
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);
  
  if (!session || !session.ws || session.ws.readyState !== 1) {
    return;
  }
  
  // Only forward audio AFTER greeting has been sent
  if (session.greetingSent) {
    sendAudioToOpenAI(session.ws, audioBuffer);
  }
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI
};





