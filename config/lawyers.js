const LAWYER_CONFIGS = {
  // Replace with your actual Telnyx number(s)
  [process.env.FROM_NUMBER]: {
    airtableKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    table: process.env.AIRTABLE_TABLE_NAME || 'Leads',
    questionFlow: [
      'What is your name?',
      'What is your phone number?',
      'Please describe your legal issue.'
    ],
    includeTranscript: false
  }
};

module.exports = LAWYER_CONFIGS;