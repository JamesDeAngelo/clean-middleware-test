const logger = require('./logger');

const sessions = new Map();

function createSession(callId, openaiWs) {
  const session = {
    callId,
    ws: openaiWs,
    streamConnection: null,
    streamSid: null,
    callControlId: null,
    callerPhone: null,
    transcript: [],
    lastAIResponseTime: null,
    saveTimeout: null,
    createdAt: new Date()
  };
  
  sessions.set(callId, session);
  logger.info(`Session created for call: ${callId}`);
  
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
}

function deleteSession(callId) {
  const session = sessions.get(callId);
  
  // Clear any pending save timeout
  if (session?.saveTimeout) {
    clearTimeout(session.saveTimeout);
  }
  
  sessions.delete(callId);
  logger.info(`Session deleted for call: ${callId}`);
}

/**
 * Add message to transcript
 */
function addToTranscript(callId, role, content) {
  const session = sessions.get(callId);
  if (session) {
    session.transcript.push({
      role, // 'user' or 'assistant'
      content,
      timestamp: new Date()
    });
  }
}

/**
 * Update last AI response time (for save trigger)
 */
function updateLastAIResponse(callId) {
  const session = sessions.get(callId);
  if (session) {
    session.lastAIResponseTime = Date.now();
  }
}

/**
 * Get all active sessions
 */
function getAllSessions() {
  return Array.from(sessions.values());
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  addToTranscript,
  updateLastAIResponse,
  getAllSessions
};