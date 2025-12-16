const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

async function saveLeadToAirtable(leadData) {
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    
    const record = {
      fields: {
        "Name": leadData.name || "",
        "Phone Number": leadData.phoneNumber || "",
        "Date of Accident": leadData.dateOfAccident || "",
        "Location of Accident": leadData.locationOfAccident || "",
        "Type of Truck": leadData.typeOfTruck || "",
        "Injuries Sustained": leadData.injuriesSustained || "",
        "Police Report Filed?": leadData.policeReportFiled || "",
        "Call Timestamp": leadData.callTimestamp || new Date().toISOString(),
        "Raw Transcript": leadData.rawTranscript || ""
      }
    };
    
    logger.info(`Saving to Airtable: ${JSON.stringify(record.fields)}`);
    
    const response = await axios.post(url, record, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    logger.info(`✓ Saved to Airtable. Record ID: ${response.data.id}`);
    return response.data;
    
  } catch (error) {
    logger.error(`❌ Airtable error: ${error.message}`);
    if (error.response) {
      logger.error(`Response: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

module.exports = { saveLeadToAirtable };