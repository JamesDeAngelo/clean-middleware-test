 const axios = require('axios');
const logger = require('./utils/logger');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Lead Contacts';
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

/**
 * Determine if lead is qualified based on PI law criteria
 */
function qualifyLead(leadData) {
  // PI lawyers typically need:
  // 1. Commercial truck involved (higher settlement values)
  // 2. Medical treatment (shows damages)
  // 3. Recent accident (statute of limitations)
  // 4. Injuries documented
  
  let qualificationScore = 0;
  let qualificationNotes = [];
  
  // Commercial truck = HIGH VALUE (most important)
  if (leadData.wasCommercialTruckInvolved === "Yes") {
    qualificationScore += 40;
    qualificationNotes.push("Commercial truck involved");
  }
  
  // Medical treatment = SHOWS DAMAGES (critical)
  if (leadData.wereTreatedByDoctorOrHospital === "Yes") {
    qualificationScore += 30;
    qualificationNotes.push("Medical treatment received");
  }
  
  // Has injuries documented
  if (leadData.injuriesSustained && leadData.injuriesSustained.trim() !== "") {
    qualificationScore += 15;
    qualificationNotes.push("Injuries documented");
  }
  
  // Police report filed = DOCUMENTATION
  if (leadData.policeReportFiled === "Yes") {
    qualificationScore += 10;
    qualificationNotes.push("Police report filed");
  }
  
  // Recent accident (within last 6 months is ideal)
  if (leadData.dateOfAccident) {
    const accidentDate = new Date(leadData.dateOfAccident);
    const today = new Date();
    const daysSince = Math.floor((today - accidentDate) / (1000 * 60 * 60 * 24));
    
    if (daysSince <= 180) { // 6 months
      qualificationScore += 5;
      qualificationNotes.push("Recent accident");
    }
  }
  
  // Determine qualification status
  let status = "Not Qualified";
  if (qualificationScore >= 75) {
    status = "Highly Qualified"; // HOT LEAD - commercial truck + treatment
  } else if (qualificationScore >= 50) {
    status = "Qualified"; // GOOD LEAD - has key factors
  } else if (qualificationScore >= 30) {
    status = "Maybe Qualified"; // NEEDS REVIEW - some factors
  }
  
  logger.info(`📊 Qualification: ${status} (Score: ${qualificationScore}/100)`);
  logger.info(`   Factors: ${qualificationNotes.join(", ")}`);
  
  return status;
}

/**
 * Save lead data to Airtable with retry logic
 */
async function saveLeadToAirtable(leadData, rawTranscript = "", retries = 3) {
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
  if (leadData.dateOfAccident && leadData.dateOfAccident.trim() !== "") {
    fields["Date of Accident"] = leadData.dateOfAccident;
  }
  
  // NEW: Add Raw Transcript (VERY IMPORTANT for lawyers)
  if (rawTranscript && rawTranscript.trim() !== "") {
    fields["Raw Transcript"] = rawTranscript;
    logger.info(`📝 Saving transcript (${rawTranscript.length} chars)`);
  }
  
  // NEW: Add Qualification Status
  const qualificationStatus = qualifyLead(leadData);
  fields["Qualified?"] = qualificationStatus;

  const payload = { fields };

  logger.info(`📊 Attempting to save lead to Airtable: ${leadData.name || 'Unknown'}`);
  logger.info(`   Qualification: ${qualificationStatus}`);

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


