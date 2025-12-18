const logger = require('./logger');

const sessions = new Map();

function createSession(callId, ws) {
  const session = {
    ws,
    callId,
    streamConnection: null,
    streamSid: null,
    callControlId: null,
    callerPhone: null,
    transcript: {
      user: [],
      assistant: []
    },
    lastAiResponseTime: null,
    createdAt: new Date()
  };
  
  sessions.set(callId, session);
  logger.info(`✓ Session created: ${callId}`);
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

function deleteSession(callId) {
  const deleted = sessions.delete(callId);
  if (deleted) {
    logger.info(`✓ Session deleted: ${callId}`);
  }
  return deleted;
}

function addUserTranscript(callId, text) {
  const session = sessions.get(callId);
  if (session) {
    session.transcript.user.push({
      text,
      timestamp: new Date()
    });
    logger.info(`👤 User said: "${text}"`);
  }
}

function addAssistantTranscript(callId, text) {
  const session = sessions.get(callId);
  if (session) {
    session.transcript.assistant.push({
      text,
      timestamp: new Date()
    });
    session.lastAiResponseTime = Date.now();
    logger.info(`🤖 AI said: "${text}"`);
  }
}

function getFullTranscript(callId) {
  const session = sessions.get(callId);
  if (!session) return "";
  
  const allMessages = [
    ...session.transcript.user.map(t => ({ ...t, speaker: 'User' })),
    ...session.transcript.assistant.map(t => ({ ...t, speaker: 'AI' }))
  ].sort((a, b) => a.timestamp - b.timestamp);
  
  return allMessages
    .map(msg => `${msg.speaker}: ${msg.text}`)
    .join('\n');
}

function getAllSessions() {
  return Array.from(sessions.entries()).map(([callId, session]) => ({
    callId,
    callerPhone: session.callerPhone,
    createdAt: session.createdAt,
    lastActivity: session.lastAiResponseTime
  }));
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  addUserTranscript,
  addAssistantTranscript,
  getFullTranscript,
  getAllSessions
};