const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

async function saveLeadToAirtable(leadData, retryCount = 0) {
  const MAX_RETRIES = 3;
  
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    
    // Build fields object, ONLY including non-empty values
    const fields = {
      "Call Timestamp": leadData.callTimestamp || new Date().toISOString(),
      "Raw Transcript": leadData.rawTranscript || ""
    };
    
    // Only add optional fields if they have actual values
    if (leadData.name) {
      fields["Name"] = leadData.name;
    }
    
    if (leadData.phoneNumber) {
      fields["Phone Number"] = leadData.phoneNumber;
    }
    
    if (leadData.dateOfAccident) {
      fields["Date of Accident"] = leadData.dateOfAccident;
    }
    
    if (leadData.locationOfAccident) {
      fields["Location of Accident"] = leadData.locationOfAccident;
    }
    
    if (leadData.typeOfTruck) {
      fields["Type of Truck"] = leadData.typeOfTruck;
    }
    
    if (leadData.injuriesSustained) {
      fields["Injuries Sustained"] = leadData.injuriesSustained;
    }
    
    if (leadData.policeReportFiled) {
      fields["Police Report Filed"] = leadData.policeReportFiled;
    }
    
    const record = { fields };
    
    logger.info(`💾 Saving to Airtable (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    logger.info(`Data: ${JSON.stringify(record.fields, null, 2)}`);
    
    const response = await axios.post(url, record, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    logger.info(`✅ Successfully saved to Airtable! Record ID: ${response.data.id}`);
    return response.data;
    
  } catch (error) {
    logger.error(`❌ Airtable save failed (attempt ${retryCount + 1}): ${error.message}`);
    
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    
    // Retry logic
    if (retryCount < MAX_RETRIES) {
      const waitTime = (retryCount + 1) * 2000;
      logger.info(`⏳ Retrying in ${waitTime/1000} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return saveLeadToAirtable(leadData, retryCount + 1);
    }
    
    logger.error(`❌ Failed to save to Airtable after ${MAX_RETRIES + 1} attempts`);
    throw error;
  }
}

module.exports = { saveLeadToAirtable };