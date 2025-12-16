const logger = require('./logger');

const sessions = new Map();

function createSession(callId, ws) {
  const session = {
    ws,
    streamConnection: null,
    streamSid: null,
    callControlId: null,
    callStartTime: new Date().toISOString(),
    lastResponseTime: null, // Track when AI last spoke
    saveTimer: null, // Timer for delayed save
    leadData: {
      name: null,
      phoneNumber: null, // Will be set from Telnyx caller ID
      dateOfAccident: null,
      locationOfAccident: null,
      typeOfTruck: null,
      injuriesSustained: null,
      policeReportFiled: null,
      callTimestamp: new Date().toISOString(),
      rawTranscript: []
    }
  };
  
  sessions.set(callId, session);
  logger.info(`Session created: ${callId}`);
  return session;
}

function getSession(callId) {
  return sessions.get(callId);
}

function updateSession(callId, updates) {
  const session = sessions.get(callId);
  if (session) {
    Object.assign(session, updates);
    sessions.set(callId, session);
  }
  return session;
}

function updateLeadData(callId, field, value) {
  const session = sessions.get(callId);
  if (session && session.leadData) {
    session.leadData[field] = value;
    sessions.set(callId, session);
    logger.info(`✏️  Updated ${field}: ${value}`);
  }
}

function addTranscriptEntry(callId, speaker, text) {
  const session = sessions.get(callId);
  if (session && session.leadData) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${speaker}: ${text}`;
    session.leadData.rawTranscript.push(entry);
    sessions.set(callId, session);
  }
}

function updateLastResponseTime(callId) {
  const session = sessions.get(callId);
  if (session) {
    session.lastResponseTime = Date.now();
    sessions.set(callId, session);
  }
}

function deleteSession(callId) {
  const session = sessions.get(callId);
  
  // Clear any pending save timer
  if (session?.saveTimer) {
    clearTimeout(session.saveTimer);
  }
  
  sessions.delete(callId);
  logger.info(`Session deleted: ${callId}`);
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  updateLeadData,
  addTranscriptEntry,
  updateLastResponseTime,
  deleteSession
};