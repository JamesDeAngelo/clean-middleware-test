const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI,
  extractLeadDataFromTranscript
} = require('./openai');
const { saveLeadToAirtable } = require('./airtable');

const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

// Timer to save after last AI response (2 seconds)
const SAVE_DELAY_MS = 2000;
const saveTimers = new Map();

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

          // Track AI transcripts as they come in (delta by delta)
          if (msg.type === "response.audio_transcript.delta") {
            currentAssistantMessage += msg.delta;
          }

          // When AI finishes speaking, save the full message
          if (msg.type === "response.audio_transcript.done") {
            if (currentAssistantMessage.trim()) {
              sessionStore.addAssistantTranscript(callId, currentAssistantMessage.trim());
              currentAssistantMessage = "";
              
              // Reset save timer - we'll save 2 seconds after LAST AI response
              resetSaveTimer(callId);
            }
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
          }

          // Track user transcripts
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            if (msg.transcript && msg.transcript.trim()) {
              sessionStore.addUserTranscript(callId, msg.transcript.trim());
            }
          }

          if (msg.type === "response.done") {
            logger.info(`✓ Response complete (sent ${audioChunksSent} audio chunks)`);
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
        // Trigger immediate save when connection closes
        triggerImmediateSave(callId);
      });

    } catch (error) {
      logger.error(`Connect failed: ${error.message}`);
      reject(error);
    }
  });
}

function resetSaveTimer(callId) {
  // Clear existing timer if any
  if (saveTimers.has(callId)) {
    clearTimeout(saveTimers.get(callId));
  }
  
  // Set new timer - save 2 seconds after last AI response
  const timer = setTimeout(async () => {
    await saveCallDataToAirtable(callId);
    saveTimers.delete(callId);
  }, SAVE_DELAY_MS);
  
  saveTimers.set(callId, timer);
  logger.info(`⏱️ Save timer reset for ${callId} (will save in ${SAVE_DELAY_MS}ms)`);
}

function triggerImmediateSave(callId) {
  // Clear any pending timer
  if (saveTimers.has(callId)) {
    clearTimeout(saveTimers.get(callId));
    saveTimers.delete(callId);
  }
  
  // Save immediately
  logger.info(`🚀 Triggering immediate save for ${callId}`);
  saveCallDataToAirtable(callId);
}

async function saveCallDataToAirtable(callId) {
  try {
    const session = sessionStore.getSession(callId);
    
    if (!session) {
      logger.error(`❌ Cannot save - no session found for ${callId}`);
      return;
    }
    
    // Get full transcript
    const transcript = sessionStore.getFullTranscript(callId);
    
    if (!transcript || transcript.trim().length === 0) {
      logger.warn(`⚠️ No transcript to save for ${callId}`);
      return;
    }
    
    logger.info(`📋 Full transcript:\n${transcript}`);
    
    // Extract structured data from transcript
    const leadData = await extractLeadDataFromTranscript(transcript, session.callerPhone);
    
    // Save to Airtable
    await saveLeadToAirtable(leadData);
    
    logger.info(`✅ Call data saved successfully for ${callId}`);
    
  } catch (error) {
    logger.error(`❌ Failed to save call data: ${error.message}`);
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
      instructions: "Say: Hi! This is Sarah from the law office. What happened?"
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