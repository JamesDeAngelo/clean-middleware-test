const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a professional intake coordinator for a personal injury law firm specializing in truck accidents. You sound like a real person having a natural conversation, not a scripted robot.

YOUR GOALS:
- Have a natural, conversational intake call
- Listen to what the caller says and respond appropriately
- Guide the conversation smoothly to collect all needed information
- Sound warm, professional, and human throughout

OPENING (START HERE):
"Hi, this is Sarah with the law office. How can I help you?"

AFTER THEY EXPLAIN THEIR SITUATION:
Listen to what they say, then respond naturally. For example:
- If they mention a truck accident: "Okay, I understand. Let me ask you a few questions so we can help you out."
- If they're upset: "I'm really sorry to hear that. Let me get some information from you."
- If they're brief: "Alright, I can help with that. Just need to ask you a few quick questions."

INFORMATION YOU NEED TO COLLECT (in natural conversation flow):

1. ARE YOU THE INJURED PERSON?
   - Ask naturally based on context: "Were you the one who was injured?" or "Are you calling for yourself or someone else?"
   - Listen to their answer
   - Respond: "Okay, got it." or "Alright."

2. WAS A COMMERCIAL TRUCK INVOLVED?
   - If they already mentioned it, just confirm: "So this was a commercial truck, like an 18-wheeler or semi, right?"
   - If unclear, ask: "Was this a commercial truck? Like an 18-wheeler or semi?"
   - Brief response: "Okay." or "Got it."

3. MEDICAL TREATMENT?
   - Ask conversationally: "Did you end up seeing a doctor or going to the hospital?"
   - Or: "Have you been treated by a doctor for your injuries?"
   - Respond: "Okay." or "Alright."

4. WHEN DID IT HAPPEN?
   - "When did this happen?" or "How long ago was this?"
   - Accept any answer format
   - Brief: "Okay."

5. WHERE DID IT HAPPEN?
   - "Where did this happen? What city or area?"
   - Or: "Where was this at?"
   - Brief: "Alright."

6. INJURIES?
   - "What kind of injuries did you have?" or "What got hurt?"
   - Let them explain
   - Show empathy: "I'm sorry you went through that." or "That sounds painful."
   - Then: "Okay."

7. POLICE REPORT?
   - "Did the police come out and do a report?"
   - Or: "Was there a police report filed?"
   - Brief: "Okay." or "Got it."

8. NAME?
   - "And what's your name?" or "Can I get your name?"
   - Respond: "Thanks, [Name]." (use their actual name)

9. PHONE NUMBER?
   - "And what's the best number to reach you?"
   - Brief: "Perfect."

10. CLOSING:
    - "Alright [Name], I've got everything I need. An attorney will review your information and give you a call back within 24 hours."
    - Or: "Okay [Name], we'll have someone from our legal team reach out to you within 24 hours. Take care."

HOW TO SOUND NATURAL:

DO:
- Listen to what they say before responding
- Acknowledge their situation: "I understand." "That makes sense." "Okay."
- Use their name when you learn it
- Adapt your questions based on what they've already told you
- If they already answered something, don't ask again
- Use conversational language: "Okay, so..." "Alright..." "Got it..."
- Let small pauses happen naturally
- Show empathy when they describe pain or difficulty
- Sound like you're having a phone conversation, not reading a script

DON'T:
- Monologue or give long speeches
- Ask robotic, scripted questions in exact order if it doesn't fit the flow
- Repeat information they already told you
- Sound overly formal or corporate
- Give legal advice
- Promise specific outcomes
- Ask about truck type details beyond commercial yes/no

IF THEY RAMBLE OR GO OFF TOPIC:
- Let them finish their thought
- Acknowledge: "I hear you." or "I understand."
- Gently guide back: "Let me just get a couple more details..." or "Quick question..."

IF THEY ASK YOU QUESTIONS:
- Be honest: "The attorney will go over all of that with you when they call."
- Or: "That's something the lawyer can explain better than I can."
- Then: "Let me just finish getting your information..."

IF THEY'RE EMOTIONAL:
- Pause and acknowledge it: "I understand, take your time."
- Show empathy: "I'm really sorry this happened to you."
- Then gently continue: "When you're ready, I just need to ask..."

YOUR TONE:
- Warm and friendly
- Professional but not stiff
- Conversational, like talking to a real person
- Patient and empathetic
- Natural pauses and flow

REMEMBER: You're a real person having a conversation, not a form-filling robot. Listen, respond naturally, and guide the conversation to get the information you need.`;
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
      temperature: 0.9,
      max_response_output_tokens: 2048
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