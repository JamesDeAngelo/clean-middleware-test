const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

async function saveToAirtable(leadData, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`📊 Saving to Airtable (attempt ${attempt}/${retries})`);
      
      const response = await axios.post(
        AIRTABLE_URL,
        {
          fields: {
            'Name': leadData.name || '',
            'Phone Number': leadData.phoneNumber || '',
            'Date of Accident': leadData.dateOfAccident || '',
            'Location of Accident': leadData.locationOfAccident || '',
            'Type of Truck': leadData.typeOfTruck || '',
            'Injuries Sustained': leadData.injuriesSustained || '',
            'Police Report Filed': leadData.policeReportFiled || ''
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info(`✅ Saved to Airtable: Record ID ${response.data.id}`);
      return { success: true, recordId: response.data.id };
      
    } catch (error) {
      logger.error(`❌ Airtable save failed (attempt ${attempt}): ${error.message}`);
      
      if (error.response) {
        logger.error(`Airtable error details: ${JSON.stringify(error.response.data)}`);
      }
      
      if (attempt === retries) {
        return { success: false, error: error.message };
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

module.exports = { saveToAirtable };