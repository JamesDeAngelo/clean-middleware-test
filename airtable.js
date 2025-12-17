const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Lead Contacts';
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Extract structured data from conversation transcript
 */
function extractCallData(transcript, callerPhone) {
  const data = {
    'Name': null,
    'Phone Number': callerPhone || null,
    'Date of Accident': null,
    'Location of Accident': null,
    'Type of Truck': null,
    'Injuries Sustained': null,
    'Police Report Filed': null
  };

  if (!transcript || transcript.length === 0) {
    return data;
  }

  // Combine all user messages into full text for extraction
  const fullText = transcript
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');

  const fullTextLower = fullText.toLowerCase();

  // Extract name (look for common patterns)
  const namePatterns = [
    /(?:my name is|i'm|i am|this is|name's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:call me|it's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      // Filter out common false positives
      const name = match[1].trim();
      if (!['Sarah', 'Law Office', 'Thank You'].includes(name)) {
        data['Name'] = name;
        break;
      }
    }
  }

  // Extract date - just capture what they said, don't try to parse it
  const datePatterns = [
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/i,
    /(\d{1,2}\s+(?:days?|weeks?|months?|years?)\s+ago)/i,
    /(yesterday|today|last\s+(?:night|week|month|year))/i,
    /(this\s+(?:morning|afternoon|evening|week|month))/i
  ];

  for (const pattern of datePatterns) {
    const match = fullTextLower.match(pattern);
    if (match) {
      data['Date of Accident'] = match[1];
      break;
    }
  }

  // Extract location
  const locationPatterns = [
    /(?:happened\s+(?:in|at|on)|was\s+(?:in|at|on)|accident\s+(?:in|at|on))\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Street|Road|Avenue|Boulevard|Highway|St|Rd|Ave|Blvd|Hwy))?)/i,
    /(?:intersection|corner)\s+of\s+([^.!?,]+)/i,
    /on\s+([A-Z][a-z]+\s+(?:Street|Road|Avenue|Boulevard|Highway|St|Rd|Ave|Blvd|Hwy))/i
  ];

  for (const pattern of locationPatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      data['Location of Accident'] = match[1].trim();
      break;
    }
  }

  // Extract truck type
  if (/semi|18.?wheeler|tractor.?trailer|big rig/i.test(fullTextLower)) {
    data['Type of Truck'] = 'Semi-truck / 18-wheeler';
  } else if (/pickup|pick.?up/i.test(fullTextLower)) {
    data['Type of Truck'] = 'Pickup truck';
  } else if (/delivery|fedex|ups|amazon/i.test(fullTextLower)) {
    data['Type of Truck'] = 'Delivery truck';
  } else if (/dump truck/i.test(fullTextLower)) {
    data['Type of Truck'] = 'Dump truck';
  } else if (/box truck|moving truck|u-?haul/i.test(fullTextLower)) {
    data['Type of Truck'] = 'Box truck / Moving truck';
  } else if (/truck/i.test(fullTextLower)) {
    data['Type of Truck'] = 'Truck (type unspecified)';
  }

  // Extract injuries - collect all injury mentions
  const injuryKeywords = [
    'broken', 'fractured', 'fracture', 'injury', 'injured', 'hurt', 'pain', 'painful',
    'bleeding', 'bleed', 'concussion', 'whiplash', 'bruise', 'bruised', 'cut',
    'sprain', 'sprained', 'torn', 'damaged', 'broke', 'neck', 'back', 'head',
    'arm', 'leg', 'shoulder', 'knee', 'ankle', 'wrist', 'hip', 'ribs'
  ];
  
  const injuryMentions = [];
  for (const msg of transcript) {
    if (msg.role === 'user') {
      const lowerContent = msg.content.toLowerCase();
      if (injuryKeywords.some(kw => lowerContent.includes(kw))) {
        injuryMentions.push(msg.content);
      }
    }
  }
  
  if (injuryMentions.length > 0) {
    data['Injuries Sustained'] = injuryMentions.join(' | ');
  }

  // Police report
  if (/police.*(?:came|arrived|report|filed|there|showed|called)/i.test(fullTextLower) || 
      /filed.*police.*report/i.test(fullTextLower) ||
      /yes.*police/i.test(fullTextLower)) {
    data['Police Report Filed'] = 'Yes';
  } else if (/no.*police|didn't.*call.*police|police.*didn't.*come|no.*report/i.test(fullTextLower)) {
    data['Police Report Filed'] = 'No';
  }

  return data;
}

/**
 * Save call data to Airtable with retries
 */
async function saveToAirtable(callData, retryCount = 0) {
  try {
    logger.info(`💾 Attempting to save to Airtable (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    
    // Filter out null values to keep Airtable record clean
    const fields = {};
    for (const [key, value] of Object.entries(callData)) {
      if (value !== null && value !== undefined && value !== '') {
        fields[key] = value;
      }
    }

    // If no meaningful data besides phone number, don't save
    if (Object.keys(fields).length <= 1) {
      logger.info('📭 No meaningful data to save (only phone number)');
      return { success: true, recordId: null, skipped: true };
    }

    logger.info(`📋 Sending to Airtable: ${JSON.stringify(fields, null, 2)}`);

    const response = await axios.post(
      AIRTABLE_URL,
      {
        fields: fields
      },
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    logger.info(`✅ Successfully saved to Airtable! Record ID: ${response.data.id}`);
    return { success: true, recordId: response.data.id };

  } catch (error) {
    logger.error(`❌ Airtable save failed (attempt ${retryCount + 1}): ${error.message}`);
    
    if (error.response) {
      logger.error(`Airtable error details: ${JSON.stringify(error.response.data)}`);
    }

    // Retry logic
    if (retryCount < MAX_RETRIES - 1) {
      const delay = RETRY_DELAY * (retryCount + 1); // Exponential backoff
      logger.info(`⏳ Retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return saveToAirtable(callData, retryCount + 1);
    }

    logger.error(`❌ Failed to save to Airtable after ${MAX_RETRIES} attempts`);
    return { success: false, error: error.message };
  }
}

/**
 * Process and save call after conversation ends
 */
async function processAndSaveCall(transcript, callerPhone) {
  try {
    logger.info('📊 Processing call data for Airtable...');
    
    // Extract structured data from transcript
    const callData = extractCallData(transcript, callerPhone);
    
    logger.info(`Extracted data: ${JSON.stringify(callData, null, 2)}`);
    
    // Save to Airtable
    const result = await saveToAirtable(callData);
    
    return result;
    
  } catch (error) {
    logger.error(`Error processing call: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  processAndSaveCall,
  extractCallData,
  saveToAirtable
};