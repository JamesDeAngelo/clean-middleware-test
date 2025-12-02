const logger = require('./logger');

// In-memory session storage
const sessions = new Map();

function createSession(callId, openAIWebSocket) {
  const session = {
    callId,
    ws: openAIWebSocket,
    streamConnection: null,
    createdAt: new Date()
  };
  
  sessions.set(callId, session);
  logger.info(`Session created for call: ${callId}`);
  
  return session;
}

function getSession(callId) {
  return sessions.get(callId) || null;
}

function updateSession(callId, updates) {
  const session = sessions.get(callId);
  
  if (!session) {
    logger.error(`Cannot update: Session not found for call ${callId}`);
    return null;
  }
  
  const updatedSession = { ...session, ...updates };
  sessions.set(callId, updatedSession);
  logger.info(`Session updated for call: ${callId}`);
  
  return updatedSession;
}

function deleteSession(callId) {
  const deleted = sessions.delete(callId);
  
  if (deleted) {
    logger.info(`Session deleted for call: ${callId}`);
  } else {
    logger.warn(`Attempted to delete non-existent session: ${callId}`);
  }
  
  return deleted;
}

function getAllSessions() {
  return Array.from(sessions.values());
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getAllSessions
};