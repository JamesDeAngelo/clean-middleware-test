const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

async function saveLeadToAirtable(leadData, retryCount = 0) {
  const MAX_RETRIES = 3;
  
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    
    // Format data to match your exact Airtable schema
    const record = {
      fields: {
        "Name": leadData.name || "",
        "Phone Number": leadData.phoneNumber || "",
        "Date of Accident": leadData.dateOfAccident || "",
        "Location of Accident": leadData.locationOfAccident || "",
        "Type of Truck": leadData.typeOfTruck || "",
        "Injuries Sustained": leadData.injuriesSustained || "",
        "Police Report Filed": leadData.policeReportFiled || "",
        "Call Timestamp": leadData.callTimestamp || new Date().toISOString(),
        "Raw Transcript": leadData.rawTranscript || ""
      }
    };
    
    logger.info(`💾 Saving to Airtable (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    logger.info(`Data: ${JSON.stringify(record.fields, null, 2)}`);
    
    const response = await axios.post(url, record, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    logger.info(`✅ Successfully saved to Airtable! Record ID: ${response.data.id}`);
    return response.data;
    
  } catch (error) {
    logger.error(`❌ Airtable save failed (attempt ${retryCount + 1}): ${error.message}`);
    
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    
    // Retry logic: retry up to 3 times for network/timeout errors
    if (retryCount < MAX_RETRIES) {
      const waitTime = (retryCount + 1) * 2000; // 2s, 4s, 6s
      logger.info(`⏳ Retrying in ${waitTime/1000} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return saveLeadToAirtable(leadData, retryCount + 1);
    }
    
    logger.error(`❌ Failed to save to Airtable after ${MAX_RETRIES + 1} attempts`);
    throw error;
  }
}

module.exports = { saveLeadToAirtable };