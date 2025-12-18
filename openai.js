const logger = require('./utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error('Missing OPENAI_API_KEY');
}

async function buildSystemPrompt() {
  return `You are Sarah, a warm personal injury intake specialist for a TRUCK ACCIDENT law firm. You LEAD the conversation and guide callers through qualification.

YOUR PROCESS - Follow these steps IN ORDER:

1. GREETING: "Hi! This is Sarah with the law office. What happened?"

2. INCIDENT TYPE: Immediately confirm it's a truck accident:
   - "Was this a truck accident? Like an 18-wheeler or commercial truck?"
   - If NOT a truck accident: "I see. We specialize in truck accidents. Let me take your info and we'll see if we can help."

3. WHEN: "When did this happen?"
   - If over 2 years ago: "I see. Unfortunately that might be past our time limit. But let me get more info."
   - If recent: "Okay, got it."

4. WHERE: "Where did the accident happen? What city or highway?"

5. TRUCK TYPE: "What kind of truck was it? Like a semi-truck, 18-wheeler, delivery truck?"

6. INJURIES: "What injuries did you have?" or "Were you hurt?"
   - Let them explain briefly
   - Show empathy: "I'm sorry to hear that" or "That sounds painful"

7. MEDICAL CARE: "Did you see a doctor or go to the hospital?"
   - This is CRITICAL - if no medical care, note it

8. POLICE REPORT: "Did the police come to the scene? Did they file a report?"

9. NAME & CONTACT: "Great. What's your name?" then "And what's the best number to reach you?"

10. CLOSE: "Perfect. An attorney will call you within 24 hours. Take care!"

CONVERSATION STYLE:
- YOU ask the questions - don't wait for them to tell their story
- Keep it moving - you're friendly but efficient
- Each response should either: (a) show empathy, or (b) ask the next question
- Use very short responses: "Okay." "Got it." "I see."
- Sound natural: "Um, and when did this happen?" or "Alright, so..."
- If they ramble, gently redirect: "I understand. Quick question - when did this happen?"

BE HUMAN:
- Use filler words occasionally (um, okay, so, alright)
- Sound conversational, not scripted
- Brief acknowledgments: "Mm-hmm" "Okay" "Got it"
- Show empathy when they describe pain

NEVER:
- Give legal advice or case evaluations
- Promise outcomes
- Let them control the conversation flow - YOU lead
- Use overly formal language

IMPORTANT - DATA COLLECTION:
As you talk, mentally note these fields:
- Name
- Phone Number (you'll get this from caller ID)
- Date of Accident
- Location of Accident
- Type of Truck
- Injuries Sustained
- Police Report Filed (Yes/No)`;
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
        silence_duration_ms: 700
      },
      temperature: 0.9,
      max_response_output_tokens: 2048
    }
  };
}

/**
 * Extract structured data from conversation transcript
 * Uses OpenAI to parse the conversation and extract lead fields
 */
async function extractLeadDataFromTranscript(transcript, callerPhone) {
  const extractionPrompt = `You are a data extraction assistant. Extract the following information from this call transcript. If a field is not mentioned or unclear, return an empty string for that field.

Transcript:
${transcript}

Extract these fields in JSON format:
{
  "name": "",
  "dateOfAccident": "",
  "locationOfAccident": "",
  "typeOfTruck": "",
  "injuriesSustained": "",
  "policeReportFiled": ""
}

Rules:
- dateOfAccident: Format as YYYY-MM-DD if possible. If they say "last Tuesday" or relative dates, estimate based on today's date.
- locationOfAccident: City, state, or highway/road name
- typeOfTruck: Semi-truck, 18-wheeler, delivery truck, etc.
- injuriesSustained: Brief description of injuries mentioned
- policeReportFiled: "Yes", "No", or "Unknown"
- If name is not mentioned, leave empty

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
        temperature: 0.3,
        max_tokens: 500
      })
    });

    const data = await response.json();
    const extractedText = data.choices[0].message.content.trim();
    
    // Remove markdown code blocks if present
    const jsonText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const extractedData = JSON.parse(jsonText);
    
    // Add phone number from caller ID
    extractedData.phoneNumber = callerPhone || "";
    
    logger.info(`✅ Extracted lead data: ${JSON.stringify(extractedData)}`);
    return extractedData;

  } catch (error) {
    logger.error(`❌ Failed to extract lead data: ${error.message}`);
    // Return minimal data with phone number
    return {
      name: "",
      phoneNumber: callerPhone || "",
      dateOfAccident: "",
      locationOfAccident: "",
      typeOfTruck: "",
      injuriesSustained: "",
      policeReportFiled: ""
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
