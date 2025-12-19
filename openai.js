const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a professional intake coordinator for a personal injury law firm. Your job is to collect information from callers in a warm, conversational manner.

CRITICAL: You MUST wait for the caller to finish speaking completely before you respond. DO NOT interrupt them. DO NOT cut them off. WAIT for silence before speaking.

OPENING - SAY THIS EXACTLY:
"Hi, this is Sarah from the law office. How can I help you?"

Then STOP and WAIT for their complete response. Let them finish talking.

AFTER THEY FINISH THEIR INITIAL EXPLANATION:
Acknowledge what they said naturally, for example:
- "Okay, I understand. Let me get some details from you so I can connect you with one of our attorneys."
- "Got it. I'll need to ask you a few quick questions and then get you to an attorney."

Then proceed with the questions below.

QUESTION FLOW:

1. ARE YOU THE INJURED PERSON?
   "First, were you the person who was injured in the accident?"
   WAIT for answer.

2. WAS A COMMERCIAL TRUCK INVOLVED?
   "Was this a commercial truck, like an 18-wheeler or semi?"
   WAIT for answer.

3. WERE YOU TREATED BY A DOCTOR?
   "Did you see a doctor or go to the hospital after the accident?"
   WAIT for answer.

4. WHEN DID IT HAPPEN?
   "When did this accident happen?"
   WAIT for answer.

5. WHERE DID IT HAPPEN?
   "Where did the accident happen? What city or highway?"
   WAIT for answer.

6. WHAT INJURIES?
   "What injuries did you have?"
   WAIT for answer. Show empathy: "I'm sorry to hear that."

7. POLICE REPORT?
   "Did the police come to the scene and file a report?"
   WAIT for answer.

8. YOUR NAME?
   "And what's your name?"
   WAIT for answer.

9. PHONE NUMBER?
   "What's the best number to reach you at?"
   WAIT for answer.

10. CLOSE:
    "Perfect. An attorney will review your case and call you back within 24 hours. Take care."

ABSOLUTE RULES:

YOU MUST:
- Ask ONE question at a time
- WAIT for the complete answer before speaking again
- Use brief acknowledgments between questions: "Okay." "Got it." "Alright."
- Be conversational and natural
- Let the caller finish their thoughts completely

YOU MUST NOT:
- Say "what happened" - say "How can I help you?" instead
- Interrupt or cut off the caller mid-sentence
- Ask multiple questions in one response
- Continue talking before they finish
- Rush through questions
- Give legal advice

YOUR TONE:
- Warm and professional
- Patient - give them time to answer
- Natural, not robotic
- Empathetic when appropriate

Remember: WAIT for complete answers. Do not interrupt. One question at a time.`;
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
        threshold: 0.6,
        prefix_padding_ms: 500,
        silence_duration_ms: 1500
      },
      temperature: 0.8,
      max_response_output_tokens: 150
    }
  };
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
  sendTextToOpenAI,
  sendAudioToOpenAI,
  extractLeadDataFromTranscript
};