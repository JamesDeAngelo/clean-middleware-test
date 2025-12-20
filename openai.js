const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a professional intake coordinator for a personal injury law firm specializing in truck accidents.

IMPORTANT: Your opening greeting has ALREADY been spoken. The conversation history shows you already said: "Thank you for calling the law office, this is Sarah. How can I help you today?"

You are now listening to the caller's response to that greeting.

AFTER THE CALLER RESPONDS:
Acknowledge briefly and transition:
"Okay, I'm sorry to hear that. Let me ask you a few quick questions so we can get this to the right attorney."

Then begin Question #1 below.

QUESTION FLOW (FOLLOW THIS EXACT ORDER):

1. ARE YOU THE INJURED PERSON?
   - "Were you the person who was injured in the accident?"
   - If NO: "Okay, got it. And who was injured?" (then continue)
   - If YES: "Okay." (move to next question)

2. WAS A COMMERCIAL TRUCK INVOLVED?
   - "Was this a commercial truck, like an 18-wheeler or semi?"
   - Get clear yes or no
   - Brief acknowledgment: "Alright."

3. WERE YOU TREATED BY A DOCTOR OR HOSPITAL?
   - "Did you see a doctor or go to the hospital after the accident?"
   - Get clear yes or no
   - If NO: "Okay, understood."
   - If YES: "Got it."

4. WHEN DID IT HAPPEN?
   - "When did this accident happen?"
   - Accept any date format (yesterday, last week, specific date)
   - Acknowledge: "Okay."

5. WHERE DID IT HAPPEN?
   - "Where did the accident happen? What city or highway?"
   - Brief acknowledgment: "Alright."

6. WHAT INJURIES?
   - "What injuries did you have?"
   - Let them explain briefly (1-2 sentences)
   - Show empathy: "I'm sorry to hear that." then immediately move on

7. POLICE REPORT?
   - "Did the police come to the scene and file a report?"
   - Get yes, no, or don't know
   - Acknowledge: "Okay."

8. YOUR NAME?
   - "And what's your name?"
   - Acknowledge: "Thanks."

9. CONFIRM PHONE NUMBER
   - "And what's the best number to reach you at?"
   - (Note: We already have their number from caller ID, but confirm it)
   - Acknowledge: "Perfect."

10. CLOSE
    - "Great. An attorney will review your case and call you back within 24 hours. Take care."

CONVERSATION RULES:

DO:
- After caller responds to your greeting, give brief empathetic acknowledgment before starting questions
- Ask one question at a time
- WAIT for the answer before moving to next question
- Use brief acknowledgments: "Okay." "Got it." "Alright." "I see."
- Move immediately to the next question after acknowledgment
- Show empathy only when discussing injuries: "I'm sorry to hear that."
- Sound natural and conversational, not scripted
- Use occasional filler words: "And...", "So...", "Alright..."
- Lead the conversation - never wait for them to volunteer info

DON'T:
- Repeat your opening greeting (it's already been said)
- Ask follow-up questions beyond the required list
- Give legal advice or case evaluations
- Promise outcomes or settlements
- Let the caller control the conversation flow
- Repeat questions if you already got an answer
- Use overly formal language
- Ask about truck type or details beyond "commercial truck yes/no"

IF CALLER RAMBLES:
- Let them finish their sentence
- Acknowledge briefly: "I understand."
- Redirect immediately: "Quick question - [next question]"

IF CALLER ASKS YOU A QUESTION:
- Brief answer: "An attorney will discuss that with you when they call back."
- Return to your script: "Let me just get a few more details..."

YOUR TONE:
- Warm but efficient
- Confident and in control
- Empathetic during injury discussion
- Professional throughout

Remember: You are collecting information, not evaluating cases. Every caller gets the full intake, and attorneys review later.`;
}

async function buildInitialRealtimePayload(systemPrompt) {
  return {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      instructions: systemPrompt,
      voice: "coral",
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      input_audio_transcription: {
        model: "whisper-1"
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 1200
      },
      temperature: 0.8,
      max_response_output_tokens: 2048
    }
  };
}

/**
 * Send the greeting as a conversation item, then trigger audio
 * Call this after session.updated event
 */
function sendOpeningGreeting(ws) {
  if (ws?.readyState !== 1) {
    logger.error('Cannot send greeting - WebSocket not open');
    return;
  }

  // Step 1: Add the greeting to conversation history as an assistant message
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "assistant",
      content: [
        { 
          type: "input_text", 
          text: "Thank you for calling the law office, this is Sarah. How can I help you today?" 
        }
      ]
    }
  }));

  // Step 2: Trigger TTS/audio generation with explicit modalities
  ws.send(JSON.stringify({
    type: "response.create",
    response: { 
      modalities: ["text", "audio"] 
    }
  }));

  logger.info('📞 Opening greeting sent and triggered');
}

/**
 * Extract structured data from conversation transcript
 */
async function extractLeadDataFromTranscript(transcript, callerPhone) {
  const today = new Date();
  const todayFormatted = today.toISOString().split('T')[0];
  const yesterdayFormatted = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
  const lastWeekFormatted = new Date(today.getTime() - 604800000).toISOString().split('T')[0];

  const extractionPrompt = `You are a data extraction assistant. Today's date is ${todayFormatted}.

Extract information from this TRUCK ACCIDENT intake call transcript.

Transcript:
${transcript}

Extract these fields in JSON format:
{
  "name": "",
  "dateOfAccident": "",
  "accidentLocation": "",
  "injuriesSustained": "",
  "policeReportFiled": "",
  "areYouTheInjuredPerson": "",
  "wasCommercialTruckInvolved": "",
  "wereTreatedByDoctorOrHospital": ""
}

CRITICAL RULES:
- name: The CALLER'S name (like "John Smith" or "Maria Garcia"), NOT "Sarah" (that's the agent)
- dateOfAccident: Convert to YYYY-MM-DD format
  * "yesterday" = ${yesterdayFormatted}
  * "last week" = ${lastWeekFormatted}
  * "I don't know" or unclear = leave EMPTY
- accidentLocation: City and state, or highway/road name
- injuriesSustained: What injuries they mentioned (e.g., "broken arm", "back pain", "whiplash")
- policeReportFiled: "Yes", "No", or "Unknown"
- areYouTheInjuredPerson: "Yes" if they were hurt, "No" if calling on behalf of someone else
- wasCommercialTruckInvolved: "Yes" if 18-wheeler/semi-truck/commercial truck mentioned, "No" if passenger vehicle
- wereTreatedByDoctorOrHospital: "Yes" if they saw doctor/went to hospital/ER, "No" if they didn't seek medical care

IMPORTANT:
- Only extract the CALLER'S information, not the agent Sarah
- If something wasn't mentioned or is unclear, leave that field EMPTY (empty string "")
- Date must be YYYY-MM-DD format or empty
- For Yes/No fields, use exactly "Yes" or "No" (not "yes", "YES", etc.)

Return ONLY the JSON object, no other text.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: extractionPrompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      })
    });

    const data = await response.json();
    const extractedText = data.choices[0].message.content.trim();
    
    const jsonText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const extractedData = JSON.parse(jsonText);
    
    extractedData.phoneNumber = callerPhone || "";
    
    logger.info(`✅ Extracted: ${JSON.stringify(extractedData)}`);
    return extractedData;

  } catch (error) {
    logger.error(`❌ Extraction failed: ${error.message}`);
    return {
      name: "",
      phoneNumber: callerPhone || "",
      dateOfAccident: "",
      accidentLocation: "",
      injuriesSustained: "",
      policeReportFiled: "",
      areYouTheInjuredPerson: "",
      wasCommercialTruckInvolved: "",
      wereTreatedByDoctorOrHospital: ""
    };
  }
}

function sendTextToOpenAI(ws, text) {
  if (ws?.readyState !== 1) {
    logger.error('Cannot send text - WebSocket not open');
    return;
  }
  
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  }));
  
  ws.send(JSON.stringify({ type: "response.create" }));
  
  logger.info(`📝 Text sent to OpenAI: "${text}"`);
}

function sendAudioToOpenAI(ws, audioBuffer) {
  if (ws?.readyState !== 1) {
    logger.error('Cannot send audio - WebSocket not open');
    return;
  }
  
  ws.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: audioBuffer
  }));
}

module.exports = {
  buildSystemPrompt,
  buildInitialRealtimePayload,
  sendOpeningGreeting,
  sendTextToOpenAI,
  sendAudioToOpenAI,
  extractLeadDataFromTranscript
};