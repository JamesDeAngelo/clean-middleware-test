const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Lead Contacts';

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

// Log configuration on startup
logger.info('=== AIRTABLE CONFIG ===');
logger.info(`Base ID: ${AIRTABLE_BASE_ID}`);
logger.info(`Table Name: ${AIRTABLE_TABLE_NAME}`);
logger.info(`API Key Present: ${AIRTABLE_API_KEY ? 'Yes' : 'No'}`);
logger.info(`Full URL: ${AIRTABLE_URL}`);
logger.info('=======================');

/**
 * Test Airtable connection by fetching existing records
 */
async function testConnection() {
  try {
    logger.info('🧪 Testing Airtable connection...');
    
    const response = await axios.get(
      `${AIRTABLE_URL}?maxRecords=1`,
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info('✅ Airtable connection successful!');
    logger.info(`Found ${response.data.records.length} records`);
    
    if (response.data.records.length > 0) {
      logger.info('Sample record fields:');
      logger.info(JSON.stringify(Object.keys(response.data.records[0].fields), null, 2));
    }
    
    return true;
  } catch (error) {
    logger.error('❌ Airtable connection failed!');
    logger.error(`Error: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

/**
 * Create a new lead record in Airtable
 * This uses a minimal field set that should work with any table
 */
async function createLead(data) {
  try {
    logger.info('📝 Attempting to create lead in Airtable...');
    logger.info(`Data to save: ${JSON.stringify(data, null, 2)}`);
    
    // Build fields object - only include fields that have values
    const fields = {};
    
    // Try common field names - Airtable is case-sensitive!
    if (data.name) fields['Name'] = data.name;
    if (data.phone) fields['Phone'] = data.phone;
    if (data.callerNumber) fields['Phone'] = data.callerNumber; // Fallback
    if (data.incidentType) fields['Incident Type'] = data.incidentType;
    if (data.incidentDate) fields['Incident Date'] = data.incidentDate;
    if (data.injuries) fields['Injuries'] = data.injuries;
    if (data.medicalCare) fields['Medical Care'] = data.medicalCare;
    if (data.otherParty) fields['Other Party Responsible'] = data.otherParty;
    if (data.notes) fields['Notes'] = data.notes;
    
    // Always add these
    fields['Call Date'] = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    fields['Status'] = 'New Lead';
    
    logger.info(`Fields being sent: ${JSON.stringify(fields, null, 2)}`);
    
    const response = await axios.post(
      AIRTABLE_URL,
      {
        fields: fields
      },
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`✅ Lead created in Airtable! Record ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    logger.error(`❌ Failed to create Airtable lead: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Airtable error details: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw error;
  }
}

/**
 * Create a simple test record to verify Airtable is working
 */
async function createTestRecord() {
  try {
    logger.info('🧪 Creating test record...');
    
    const testData = {
      name: 'Test Lead ' + Date.now(),
      phone: '555-1234',
      notes: 'This is a test record created at ' + new Date().toISOString()
    };
    
    await createLead(testData);
    logger.info('✅ Test record created successfully!');
    return true;
  } catch (error) {
    logger.error('❌ Test record creation failed');
    return false;
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
    logger.info(`💬 [${callId}] ${speaker}: ${message}`);
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
  extractLeadInfo,
  testConnection,
  createTestRecord
};