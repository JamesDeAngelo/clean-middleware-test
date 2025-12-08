const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Lead Contacts';

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

/**
 * Create a new lead record in Airtable
 */
async function createLead(data) {
  try {
    const response = await axios.post(
      AIRTABLE_URL,
      {
        fields: {
          'Name': data.name || 'Unknown',
          'Phone': data.phone || '',
          'Incident Type': data.incidentType || '',
          'Incident Date': data.incidentDate || '',
          'Injuries': data.injuries || '',
          'Medical Care': data.medicalCare || '',
          'Other Party Responsible': data.otherParty || '',
          'Call Date': new Date().toISOString(),
          'Status': 'New Lead',
          'Notes': data.notes || ''
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`✓ Lead created in Airtable: ${response.data.id}`);
    return response.data;
  } catch (error) {
    logger.error(`❌ Failed to create Airtable lead: ${error.message}`);
    if (error.response) {
      logger.error(`Airtable error: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Update an existing lead record
 */
async function updateLead(recordId, data) {
  try {
    const response = await axios.patch(
      `${AIRTABLE_URL}/${recordId}`,
      {
        fields: data
      },
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`✓ Lead updated in Airtable: ${recordId}`);
    return response.data;
  } catch (error) {
    logger.error(`❌ Failed to update Airtable lead: ${error.message}`);
    throw error;
  }
}

/**
 * Log a conversation transcript
 */
async function logConversation(callId, speaker, message) {
  try {
    // You could create a separate "Call Logs" table for this
    // For now, we'll just log it
    logger.info(`📝 [${speaker}]: ${message}`);
    
    // If you want to store transcripts, you could append to a field
    // or create a linked "Transcripts" table
  } catch (error) {
    logger.error(`❌ Failed to log conversation: ${error.message}`);
  }
}

/**
 * Extract lead information from conversation transcript
 */
function extractLeadInfo(transcript) {
  const leadInfo = {
    name: null,
    phone: null,
    incidentType: null,
    incidentDate: null,
    injuries: null,
    medicalCare: null,
    otherParty: null,
    notes: transcript
  };
  
  // Simple pattern matching - you can make this more sophisticated
  const lines = transcript.split('\n');
  
  lines.forEach(line => {
    const lowerLine = line.toLowerCase();
    
    // Extract name
    if (lowerLine.includes('my name is') || lowerLine.includes("i'm ")) {
      const nameMatch = line.match(/(?:my name is|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
      if (nameMatch) leadInfo.name = nameMatch[1];
    }
    
    // Extract phone
    const phoneMatch = line.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
    if (phoneMatch) leadInfo.phone = phoneMatch[0];
    
    // Extract incident type
    if (lowerLine.includes('car accident')) leadInfo.incidentType = 'Car Accident';
    if (lowerLine.includes('slip and fall')) leadInfo.incidentType = 'Slip and Fall';
    if (lowerLine.includes('work injury')) leadInfo.incidentType = 'Work Injury';
    if (lowerLine.includes('medical')) leadInfo.incidentType = 'Medical Malpractice';
    
    // Extract medical care
    if (lowerLine.includes('hospital') || lowerLine.includes('doctor')) {
      leadInfo.medicalCare = 'Yes - ' + line;
    }
  });
  
  return leadInfo;
}

module.exports = {
  createLead,
  updateLead,
  logConversation,
  extractLeadInfo
};