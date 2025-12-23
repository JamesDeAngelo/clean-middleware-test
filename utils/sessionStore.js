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
    saved: false,
    conversationComplete: false, // NEW: Flag when AI says goodbye
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
    logger.info(`👤 User: "${text}"`);
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
    logger.info(`🤖 AI: "${text}"`);
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

function markAsSaved(callId) {
  const session = sessions.get(callId);
  if (session) {
    session.saved = true;
    logger.info(`✅ Marked as saved: ${callId}`);
  }
}

function wasSaved(callId) {
  const session = sessions.get(callId);
  return session ? session.saved : false;
}

function isConversationComplete(callId) {
  const session = sessions.get(callId);
  return session ? session.conversationComplete : false;
}

function getAllSessions() {
  return Array.from(sessions.entries()).map(([callId, session]) => ({
    callId,
    callerPhone: session.callerPhone,
    createdAt: session.createdAt,
    lastActivity: session.lastAiResponseTime,
    saved: session.saved,
    complete: session.conversationComplete
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
  markAsSaved,
  wasSaved,
  isConversationComplete,
  getAllSessions
};



