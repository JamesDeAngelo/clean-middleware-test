const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Lead Contacts';
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

/**
 * Save lead data to Airtable with retry logic
 */
async function saveLeadToAirtable(leadData, retries = 3) {
  // Build fields object, EXCLUDING empty date fields
  const fields = {
    "Name": leadData.name || "",
    "Phone Number": leadData.phoneNumber || "",
    "Accident Location": leadData.accidentLocation || "",
    "Injuries Sustained": leadData.injuriesSustained || "",
    "Police Report Filed": leadData.policeReportFiled || "",
    "Are You the Injured Person?": leadData.areYouTheInjuredPerson || "",
    "Was a Commercial Truck Involved?": leadData.wasCommercialTruckInvolved || "",
    "Were You Treated by a Doctor or Hospital?": leadData.wereTreatedByDoctorOrHospital || ""
  };

  // CRITICAL FIX: Only add Date of Accident if it has a value
  // Airtable Date fields CANNOT accept empty strings
  if (leadData.dateOfAccident && leadData.dateOfAccident.trim() !== "") {
    fields["Date of Accident"] = leadData.dateOfAccident;
  }

  // NEW: Add Transcript field (long text)
  if (leadData.transcript && leadData.transcript.trim() !== "") {
    fields["Transcript"] = leadData.transcript;
  }

  // NEW: Add Qualified? field (single select)
  // Only send if it has a valid value from the 3 options
  if (leadData.qualified && ["Qualified", "Needs Review", "Unqualified"].includes(leadData.qualified)) {
    fields["Qualified?"] = leadData.qualified;
  }

  // Note: "Last Modified" is a last modified time field - Airtable handles this automatically
  // We don't need to send it, it updates on its own

  const payload = { fields };

  logger.info(`📊 Attempting to save lead to Airtable: ${leadData.name || 'Unknown'}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        AIRTABLE_API_URL,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info(`✅ Lead saved to Airtable successfully! Record ID: ${response.data.id}`);
      return response.data;

    } catch (error) {
      logger.error(`❌ Airtable save attempt ${attempt}/${retries} failed: ${error.message}`);
      
      if (error.response) {
        logger.error(`Airtable error details: ${JSON.stringify(error.response.data)}`);
      }

      if (attempt === retries) {
        throw new Error(`Failed to save to Airtable after ${retries} attempts: ${error.message}`);
      }

      const waitTime = Math.pow(2, attempt) * 1000;
      logger.info(`⏳ Retrying in ${waitTime / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Test Airtable connection
 */
async function testAirtableConnection() {
  try {
    const response = await axios.get(
      `${AIRTABLE_API_URL}?maxRecords=1`,
      {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`
        },
        timeout: 5000
      }
    );

    logger.info('✅ Airtable connection test successful');
    return true;

  } catch (error) {
    logger.error(`❌ Airtable connection test failed: ${error.message}`);
    if (error.response) {
      logger.error(`Error details: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

module.exports = {
  saveLeadToAirtable,
  testAirtableConnection
};
