const LAWYER_CONFIGS = {
  // Use your FROM_NUMBER from .env
  [process.env.FROM_NUMBER]: {
    airtableKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    table: process.env.AIRTABLE_TABLE_NAME || 'Leads',
    questionFlow: [
      'What is your full name?',
      'What is the best phone number to reach you?',
      'Please briefly describe your legal issue.'
    ],
    includeTranscript: false
  }
  
  // To add more lawyers, add more entries like:
  // "+15551234567": {
  //   airtableKey: "keyXXXXX",
  //   baseId: "appYYYYY",
  //   table: "Leads",
  //   questionFlow: ["Name?", "Issue?"],
  //   includeTranscript: false
  // }
};

module.exports = LAWYER_CONFIGS;