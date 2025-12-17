const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { processAndSaveCall } = require('./airtable');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI
} = require('./openai');

const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
const SAVE_DELAY_MS = 2000; // Save 2 seconds after last AI response

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
          
          // Handle audio from OpenAI - SEND DIRECTLY BACK TO TELNYX
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            
            if (!session) {
              logger.error(`❌ NO SESSION found for callId: ${callId}`);
              return;
            }
            
            if (!session.streamConnection) {
              logger.error(`❌ NO streamConnection in session`);
              return;
            }
            
            if (session.streamConnection.readyState !== 1) {
              logger.error(`❌ streamConnection not ready. State: ${session.streamConnection.readyState}`);
              return;
            }
            
            // Send audio DIRECTLY back to Telnyx via WebSocket
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
              logger.info(`📤 Sent ${audioChunksSent} audio chunks to Telnyx`);
            }
          }

          // CAPTURE AI TRANSCRIPT
          if (msg.type === "response.audio_transcript.delta") {
            logger.info(`🤖 AI: "${msg.delta}"`);
            // We'll capture the full transcript on completion
          }

          // CAPTURE FULL AI RESPONSE
          if (msg.type === "response.audio_transcript.done") {
            const transcript = msg.transcript;
            if (transcript) {
              sessionStore.addToTranscript(callId, 'assistant', transcript);
              logger.info(`🤖 AI (complete): "${transcript}"`);
            }
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
          }

          // CAPTURE USER TRANSCRIPT
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            const userText = msg.transcript;
            sessionStore.addToTranscript(callId, 'user', userText);
            logger.info(`👤 User: "${userText}"`);
          }

          // TRIGGER SAVE 2 SECONDS AFTER LAST AI RESPONSE
          if (msg.type === "response.done") {
            logger.info(`✓ Response complete (sent ${audioChunksSent} audio chunks)`);
            audioChunksSent = 0;
            
            // Update last AI response time
            sessionStore.updateLastAIResponse(callId);
            
            // Schedule save (will be rescheduled if another response comes)
            scheduleAirtableSave(callId);
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
            logger.info(`✓ Session updated. Audio formats: in=${msg.session?.input_audio_format}, out=${msg.session?.output_audio_format}`);
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
        // Save immediately on close
        saveCallToAirtable(callId);
      });

    } catch (error) {
      logger.error(`Connect failed: ${error.message}`);
      reject(error);
    }
  });
}

/**
 * Schedule Airtable save 2 seconds after last AI response
 */
function scheduleAirtableSave(callId) {
  const session = sessionStore.getSession(callId);
  
  if (!session) {
    return;
  }
  
  // Clear existing timeout if any
  if (session.saveTimeout) {
    clearTimeout(session.saveTimeout);
  }
  
  // Schedule new save
  session.saveTimeout = setTimeout(() => {
    saveCallToAirtable(callId);
  }, SAVE_DELAY_MS);
  
  logger.info(`⏰ Airtable save scheduled for ${SAVE_DELAY_MS}ms from now`);
}

/**
 * Save call data to Airtable
 */
async function saveCallToAirtable(callId) {
  const session = sessionStore.getSession(callId);
  
  if (!session) {
    logger.warn(`No session found for callId: ${callId}`);
    return;
  }
  
  // Don't save if transcript is empty
  if (!session.transcript || session.transcript.length === 0) {
    logger.info('📭 No transcript to save');
    return;
  }
  
  logger.info(`💾 Saving call to Airtable (${session.transcript.length} messages)`);
  
  try {
    const result = await processAndSaveCall(session.transcript, session.callerPhone);
    
    if (result.success) {
      logger.info(`✅ Call saved successfully! Record ID: ${result.recordId}`);
    } else {
      logger.error(`❌ Failed to save call: ${result.error}`);
    }
  } catch (error) {
    logger.error(`Error saving to Airtable: ${error.message}`);
  }
}

function triggerGreeting(ws) {
  if (ws?.readyState !== 1) {
    logger.error('Cannot trigger greeting - WebSocket not open');
    return;
  }
  
  ws.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["text", "audio"],
      instructions: "Say: Hi! This is Sarah from the law office. How can I help you today?"
    }
  }));
  
  logger.info('🎙️ Greeting triggered');
}

function attachTelnyxStream(callId, telnyxWs, streamSid) {
  const session = sessionStore.getSession(callId);
  
  if (!session) {
    logger.error(`❌ Cannot attach stream - No session for: ${callId}`);
    return;
  }
  
  session.streamConnection = telnyxWs;
  session.streamSid = streamSid;
  sessionStore.updateSession(callId, session);
  logger.info(`✓ Stream attached. WebSocket state: ${telnyxWs.readyState}`);
}

function forwardAudioToOpenAI(callId, audioBuffer) {
  const session = sessionStore.getSession(callId);
  
  if (!session) {
    return;
  }
  
  if (!session.ws || session.ws.readyState !== 1) {
    return;
  }
  
  sendAudioToOpenAI(session.ws, audioBuffer);
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI
};