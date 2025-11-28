const sessions = new Map();

function createSession(callId, wsConnection) {
  sessions.set(callId, wsConnection);
}

function getSession(callId) {
  return sessions.get(callId) || null;
}

function deleteSession(callId) {
  sessions.delete(callId);
}

module.exports = {
  createSession,
  getSession,
  deleteSession
};