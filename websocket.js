const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI
} = require('./openai');
const DataExtractor = require('./dataExtractor');
const { saveToAirtable } = require('./airtable');

const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

async function connectToOpenAI(callId, phoneNumber = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const ws = new WebSocket(OPENAI_URL, {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      let audioChunksSent = 0;
      let lastAIResponseTime = null;
      let saveTimeout = null;

      ws.on('open', async () => {
        logger.info('✓ OpenAI connected');
        
        const systemPrompt = await buildSystemPrompt();
        const initPayload = await buildInitialRealtimePayload(systemPrompt);
        
        ws.send(JSON.stringify(initPayload));
        
        // Create session with data extractor
        sessionStore.createSession(callId, ws);
        const session = sessionStore.getSession(callId);
        session.dataExtractor = new DataExtractor();
        
        // Set phone number immediately if we have it
        if (phoneNumber) {
          session.dataExtractor.setPhoneNumber(phoneNumber);
          logger.info(`📞 Phone number set in DataExtractor: ${phoneNumber}`);
        }
        
        sessionStore.updateSession(callId, session);
        
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
            
            try {
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
            } catch (err) {
              logger.error(`❌ Error sending audio: ${err.message}`);
            }
          }

          if (msg.type === "response.audio_transcript.delta") {
            logger.info(`🤖 AI: "${msg.delta}"`);
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
          }

          // Extract data from user's message
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            logger.info(`👤 User: "${msg.transcript}"`);
            
            const session = sessionStore.getSession(callId);
            if (session?.dataExtractor) {
              // Extract data from this message
              session.dataExtractor.updateFromTranscript(msg.transcript, '');
              
              // Log current data state for debugging
              const currentData = session.dataExtractor.getData();
              logger.info(`📊 Current extracted data: ${JSON.stringify(currentData)}`);
              
              sessionStore.updateSession(callId, session);
            }
          }

          if (msg.type === "response.done") {
            logger.info(`✓ Response complete (sent ${audioChunksSent} audio chunks)`);
            audioChunksSent = 0;
            
            // Track last AI response time for save trigger
            lastAIResponseTime = Date.now();
            
            // Clear any existing timeout
            if (saveTimeout) {
              clearTimeout(saveTimeout);
            }
            
            // Set new timeout: save 2 seconds after last AI response
            saveTimeout = setTimeout(() => {
              const session = sessionStore.getSession(callId);
              if (session?.dataExtractor && !session.dataSaved) {
                const leadData = session.dataExtractor.getData();
                
                // Log what we're about to check
                logger.info(`💾 Checking data for save: ${JSON.stringify(leadData)}`);
                logger.info(`💾 Has minimum data? ${session.dataExtractor.hasMinimumData()}`);
                
                // Save if we have ANY data with phone number
                if (session.dataExtractor.hasMinimumData() || leadData.phoneNumber) {
                  logger.info('💾 Saving to Airtable (2 seconds after last AI response)');
                  saveToAirtable(leadData).then(result => {
                    if (result.success) {
                      logger.info(`✅ Successfully saved! Record ID: ${result.recordId}`);
                      session.dataSaved = true;
                      sessionStore.updateSession(callId, session);
                    } else {
                      logger.error(`❌ Save failed: ${result.error}`);
                    }
                  });
                } else {
                  logger.info(`⏭️ Skipping save - missing phone number. Data: ${JSON.stringify(leadData)}`);
                }
              }
            }, 2000);
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
        
        // Final save attempt on close if not already saved
        const session = sessionStore.getSession(callId);
        if (session?.dataExtractor && !session.dataSaved) {
          const leadData = session.dataExtractor.getData();
          
          logger.info(`💾 Final save attempt on close. Data: ${JSON.stringify(leadData)}`);
          
          // Save if we have ANY data with phone number
          if (leadData.phoneNumber) {
            logger.info('💾 Final save on connection close');
            saveToAirtable(leadData).then(result => {
              if (result.success) {
                logger.info(`✅ Final save successful! Record ID: ${result.recordId}`);
              } else {
                logger.error(`❌ Final save failed: ${result.error}`);
              }
            });
          } else {
            logger.info('⏭️ No final save - no phone number collected');
          }
        }
        
        if (saveTimeout) {
          clearTimeout(saveTimeout);
        }
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