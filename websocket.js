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
const SAVE_DELAY_MS = 2000; // Save 2 seconds after last AI response

// Simple keyword extraction from speech
function extractDataFromTranscript(transcript, field) {
  const text = transcript.toLowerCase();
  
  // Name extraction
  if (field === 'name') {
    const namePatterns = [
      /my name is ([a-z]+(?:\s[a-z]+)?)/i,
      /i'm ([a-z]+(?:\s[a-z]+)?)/i,
      /this is ([a-z]+(?:\s[a-z]+)?)/i,
      /call me ([a-z]+(?:\s[a-z]+)?)/i
    ];
    for (const pattern of namePatterns) {
      const match = transcript.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  // Date extraction
  if (field === 'dateOfAccident') {
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i,
      /(last|this)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /(\d{1,2})\s+(days?|weeks?|months?|years?)\s+ago/i
    ];
    for (const pattern of datePatterns) {
      const match = transcript.match(pattern);
      if (match) return match[0];
    }
  }
  
  // Location extraction
  if (field === 'locationOfAccident') {
    const locationPatterns = [
      /on\s+([a-z0-9\s]+(?:street|avenue|road|highway|boulevard|drive|lane|way))/i,
      /at\s+([a-z0-9\s]+(?:street|avenue|road|highway|boulevard|drive|lane|way))/i,
      /in\s+([a-z\s]+,?\s*[a-z]+)/i // "in Los Angeles" or "in downtown"
    ];
    for (const pattern of locationPatterns) {
      const match = transcript.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  // Truck type extraction
  if (field === 'typeOfTruck') {
    if (text.includes('semi') || text.includes('tractor') || text.includes('18 wheeler')) return 'Semi-truck';
    if (text.includes('delivery') || text.includes('fedex') || text.includes('ups') || text.includes('amazon')) return 'Delivery truck';
    if (text.includes('pickup')) return 'Pickup truck';
    if (text.includes('dump')) return 'Dump truck';
    if (text.includes('box truck') || text.includes('moving truck')) return 'Box truck';
  }
  
  // Injuries extraction - capture the whole response
  if (field === 'injuriesSustained') {
    if (text.includes('hurt') || text.includes('pain') || text.includes('injur') || 
        text.includes('broke') || text.includes('fracture') || text.includes('whiplash')) {
      return transcript; // Return full text for context
    }
  }
  
  // Police report - convert to simple text
  if (field === 'policeReportFiled') {
    if (text.includes('yes') || text.includes('they came') || text.includes('police came') || 
        text.includes('filed') || text.includes('report')) return 'Yes';
    if (text.includes('no') || text.includes('didn\'t') || text.includes('not')) return 'No';
  }
  
  return null;
}

async function scheduleSaveToAirtable(callId) {
  const session = sessionStore.getSession(callId);
  if (!session) return;
  
  // Clear any existing timer
  if (session.saveTimer) {
    clearTimeout(session.saveTimer);
  }
  
  // Schedule save for 2 seconds from now
  session.saveTimer = setTimeout(async () => {
    logger.info(`⏰ Save timer triggered for call: ${callId}`);
    await saveSessionToAirtable(callId);
  }, SAVE_DELAY_MS);
  
  sessionStore.updateSession(callId, session);
}

async function saveSessionToAirtable(callId) {
  const session = sessionStore.getSession(callId);
  
  if (!session?.leadData) {
    logger.info('No lead data to save');
    return;
  }
  
  try {
    // Combine transcript array into single string
    const rawTranscript = session.leadData.rawTranscript.join('\n');
    
    const leadDataToSave = {
      ...session.leadData,
      rawTranscript
    };
    
    logger.info('💾 Saving call data to Airtable...');
    await saveLeadToAirtable(leadDataToSave);
    logger.info('✅ Call data saved to Airtable successfully');
    
    // Mark as saved so we don't save again
    session.savedToAirtable = true;
    sessionStore.updateSession(callId, session);
    
  } catch (error) {
    logger.error(`❌ Failed to save to Airtable: ${error.message}`);
    // Error already logged with retry attempts in airtable.js
  }
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
          
          // Handle audio from OpenAI - send back to Telnyx
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

          // Capture AI responses and update last response time
          if (msg.type === "response.audio_transcript.delta") {
            logger.info(`🤖 AI: "${msg.delta}"`);
            sessionStore.addTranscriptEntry(callId, 'AI', msg.delta);
          }

          // When AI finishes speaking, update timer
          if (msg.type === "response.done") {
            logger.info(`✓ Response complete (sent ${audioChunksSent} audio chunks)`);
            audioChunksSent = 0;
            
            // Update last response time and schedule save
            sessionStore.updateLastResponseTime(callId);
            scheduleSaveToAirtable(callId);
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
              
              // Extract date
              const date = extractDataFromTranscript(userText, 'dateOfAccident');
              if (date && !session.leadData.dateOfAccident) {
                sessionStore.updateLeadData(callId, 'dateOfAccident', date);
              }
              
              // Extract location
              const location = extractDataFromTranscript(userText, 'locationOfAccident');
              if (location && !session.leadData.locationOfAccident) {
                sessionStore.updateLeadData(callId, 'locationOfAccident', location);
              }
              
              // Extract truck type
              const truckType = extractDataFromTranscript(userText, 'typeOfTruck');
              if (truckType && !session.leadData.typeOfTruck) {
                sessionStore.updateLeadData(callId, 'typeOfTruck', truckType);
              }
              
              // Extract injuries - append if already exists
              const injuries = extractDataFromTranscript(userText, 'injuriesSustained');
              if (injuries) {
                const existing = session.leadData.injuriesSustained || '';
                const combined = existing ? `${existing}; ${injuries}` : injuries;
                sessionStore.updateLeadData(callId, 'injuriesSustained', combined);
              }
              
              // Extract police report
              const policeReport = extractDataFromTranscript(userText, 'policeReportFiled');
              if (policeReport && !session.leadData.policeReportFiled) {
                sessionStore.updateLeadData(callId, 'policeReportFiled', policeReport);
              }
            }
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            logger.info('🎤 User speaking');
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            logger.info('🔇 User stopped');
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
        logger.info('OpenAI connection closed');
        
        // Don't save here - the timer or hangup handler will do it
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
  forwardAudioToOpenAI,
  saveSessionToAirtable // Export for use in telnyx.js
};