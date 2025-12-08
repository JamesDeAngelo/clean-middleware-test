const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI
} = require('./openai');
const { createLead, extractLeadInfo, logConversation } = require('./airtable');

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
      let conversationTranscript = [];

      ws.on('open', async () => {
        logger.info('✓ OpenAI connected');
        
        const systemPrompt = await buildSystemPrompt();
        const initPayload = await buildInitialRealtimePayload(systemPrompt);
        
        ws.send(JSON.stringify(initPayload));
        
        // Initialize session with transcript array
        sessionStore.createSession(callId, ws);
        const session = sessionStore.getSession(callId);
        session.transcript = [];
        session.leadData = {};
        sessionStore.updateSession(callId, session);
        
        resolve(ws);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const session = sessionStore.getSession(callId);
          
          // Handle audio from OpenAI - SEND DIRECTLY BACK TO TELNYX
          if (msg.type === "response.audio.delta" && msg.delta) {
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

          // LOG AI RESPONSES TO AIRTABLE
          if (msg.type === "response.audio_transcript.delta") {
            logger.info(`🤖 AI: "${msg.delta}"`);
            
            if (session && session.transcript) {
              session.currentAIResponse = (session.currentAIResponse || '') + msg.delta;
              sessionStore.updateSession(callId, session);
            }
          }

          // COMPLETE AI RESPONSE - LOG IT
          if (msg.type === "response.audio_transcript.done") {
            if (session && session.currentAIResponse) {
              const aiMessage = session.currentAIResponse.trim();
              session.transcript.push({
                speaker: 'AI',
                message: aiMessage,
                timestamp: new Date().toISOString()
              });
              
              // Log to console and Airtable
              logConversation(callId, 'AI', aiMessage);
              
              session.currentAIResponse = '';
              sessionStore.updateSession(callId, session);
            }
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
          }

          // LOG USER SPEECH TO AIRTABLE
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            const userMessage = msg.transcript;
            logger.info(`👤 User: "${userMessage}"`);
            
            if (session && session.transcript) {
              session.transcript.push({
                speaker: 'User',
                message: userMessage,
                timestamp: new Date().toISOString()
              });
              
              // Log to Airtable
              logConversation(callId, 'User', userMessage);
              
              // Extract any lead information from what user said
              const fullTranscript = session.transcript
                .map(t => `${t.speaker}: ${t.message}`)
                .join('\n');
              
              const extractedInfo = extractLeadInfo(fullTranscript);
              
              // Merge with existing lead data
              session.leadData = {
                ...session.leadData,
                ...extractedInfo
              };
              
              sessionStore.updateSession(callId, session);
              
              logger.info(`📊 Lead data updated: ${JSON.stringify(session.leadData)}`);
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

      ws.on('close', async () => {
        logger.info('OpenAI closed');
        
        // SAVE TO AIRTABLE WHEN CALL ENDS
        const session = sessionStore.getSession(callId);
        if (session && session.leadData) {
          try {
            // Compile full transcript
            const fullTranscript = session.transcript
              .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.speaker}: ${t.message}`)
              .join('\n');
            
            session.leadData.notes = fullTranscript;
            
            // Create lead in Airtable
            await createLead(session.leadData);
            logger.info('✓ Lead saved to Airtable');
          } catch (error) {
            logger.error(`❌ Failed to save lead: ${error.message}`);
          }
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
