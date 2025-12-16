const WebSocket = require('ws');
const logger = require('./utils/logger');
const sessionStore = require('./utils/sessionStore');
const { saveLeadToAirtable } = require('./airtable');
const { 
  buildSystemPrompt, 
  buildInitialRealtimePayload,
  sendAudioToOpenAI
} = require('./openai');

const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

// Simple keyword extraction
function extractDataFromTranscript(transcript, field) {
  const text = transcript.toLowerCase();
  
  // Name extraction
  if (field === 'name') {
    const namePatterns = [
      /my name is ([a-z]+(?:\s[a-z]+)?)/i,
      /i'm ([a-z]+(?:\s[a-z]+)?)/i,
      /this is ([a-z]+(?:\s[a-z]+)?)/i
    ];
    for (const pattern of namePatterns) {
      const match = transcript.match(pattern);
      if (match) return match[1];
    }
  }
  
  // Phone number extraction
  if (field === 'phoneNumber') {
    const phonePattern = /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\(\d{3}\)\s?\d{3}[-.\s]?\d{4})/;
    const match = transcript.match(phonePattern);
    if (match) return match[1];
  }
  
  // Date extraction (simple)
  if (field === 'dateOfAccident') {
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i,
      /(last|this)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
    ];
    for (const pattern of datePatterns) {
      const match = transcript.match(pattern);
      if (match) return match[0];
    }
  }
  
  // Truck type
  if (field === 'typeOfTruck') {
    if (text.includes('semi') || text.includes('tractor')) return 'Semi-truck';
    if (text.includes('delivery')) return 'Delivery truck';
    if (text.includes('pickup')) return 'Pickup truck';
    if (text.includes('dump')) return 'Dump truck';
    if (text.includes('fedex') || text.includes('ups')) return 'Delivery truck';
  }
  
  // Police report
  if (field === 'policeReportFiled') {
    if (text.includes('yes') || text.includes('they came') || text.includes('police came')) return 'Yes';
    if (text.includes('no') || text.includes('didn\'t come') || text.includes('no police')) return 'No';
  }
  
  return null;
}

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
          
          // Handle audio from OpenAI
          if (msg.type === "response.audio.delta" && msg.delta) {
            const session = sessionStore.getSession(callId);
            
            if (!session?.streamConnection || session.streamConnection.readyState !== 1) {
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
              logger.info(`📤 Sent ${audioChunksSent} audio chunks to Telnyx`);
            }
          }

          // Capture AI responses
          if (msg.type === "response.audio_transcript.delta") {
            logger.info(`🤖 AI: "${msg.delta}"`);
            sessionStore.addTranscriptEntry(callId, 'AI', msg.delta);
          }

          // Capture user speech transcripts and extract data
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            const userText = msg.transcript;
            logger.info(`👤 User: "${userText}"`);
            sessionStore.addTranscriptEntry(callId, 'User', userText);
            
            // Try to extract data from user's response
            const session = sessionStore.getSession(callId);
            if (session) {
              // Extract name
              const name = extractDataFromTranscript(userText, 'name');
              if (name && !session.leadData.name) {
                sessionStore.updateLeadData(callId, 'name', name);
              }
              
              // Extract phone
              const phone = extractDataFromTranscript(userText, 'phoneNumber');
              if (phone && !session.leadData.phoneNumber) {
                sessionStore.updateLeadData(callId, 'phoneNumber', phone);
              }
              
              // Extract date
              const date = extractDataFromTranscript(userText, 'dateOfAccident');
              if (date && !session.leadData.dateOfAccident) {
                sessionStore.updateLeadData(callId, 'dateOfAccident', date);
              }
              
              // Extract truck type
              const truckType = extractDataFromTranscript(userText, 'typeOfTruck');
              if (truckType && !session.leadData.typeOfTruck) {
                sessionStore.updateLeadData(callId, 'typeOfTruck', truckType);
              }
              
              // Extract police report
              const policeReport = extractDataFromTranscript(userText, 'policeReportFiled');
              if (policeReport && !session.leadData.policeReportFiled) {
                sessionStore.updateLeadData(callId, 'policeReportFiled', policeReport);
              }
              
              // Capture injuries and location as freeform
              if (!session.leadData.injuriesSustained && 
                  (userText.toLowerCase().includes('hurt') || 
                   userText.toLowerCase().includes('pain') ||
                   userText.toLowerCase().includes('injur'))) {
                sessionStore.updateLeadData(callId, 'injuriesSustained', userText);
              }
              
              if (!session.leadData.locationOfAccident && 
                  (userText.toLowerCase().includes('street') || 
                   userText.toLowerCase().includes('avenue') ||
                   userText.toLowerCase().includes('road') ||
                   userText.toLowerCase().includes('highway'))) {
                sessionStore.updateLeadData(callId, 'locationOfAccident', userText);
              }
            }
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
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
        
        // Save to Airtable when call ends
        const session = sessionStore.getSession(callId);
        if (session?.leadData) {
          try {
            // Combine transcript array into single string
            const rawTranscript = session.leadData.rawTranscript.join('\n');
            
            const leadDataToSave = {
              ...session.leadData,
              rawTranscript
            };
            
            logger.info('💾 Saving call data to Airtable...');
            await saveLeadToAirtable(leadDataToSave);
            logger.info('✓ Data saved to Airtable');
          } catch (error) {
            logger.error(`Failed to save to Airtable: ${error.message}`);
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
  
  if (!session?.ws || session.ws.readyState !== 1) {
    return;
  }
  
  sendAudioToOpenAI(session.ws, audioBuffer);
}

module.exports = {
  connectToOpenAI,
  attachTelnyxStream,
  forwardAudioToOpenAI
};