const logger = require('./logger');

const sessions = {};

function createSession(callId, ws) {
  if (!sessions[callId]) {
    sessions[callId] = {};
  }
  sessions[callId].ws = ws;
  sessions[callId].readyState = ws.readyState;
  sessions[callId].call_control_id = callId;
  logger.info(`Session created for call: ${callId}`);
}

function getSession(callId) {
  return sessions[callId];
}

function deleteSession(callId) {
  if (sessions[callId]) {
    delete sessions[callId];
    logger.info(`Session deleted for call: ${callId}`);
  }
}

function setStreamId(callId, streamId) {
  if (!sessions[callId]) {
    sessions[callId] = {};
  }
  sessions[callId].stream_id = streamId;
  logger.info(`StreamId ${streamId} stored for call: ${callId}`);
}

function getStreamId(callId) {
  const streamId = sessions[callId]?.stream_id;
  if (!streamId) {
    logger.error(`No streamId found for call: ${callId}`);
  }
  return streamId;
}

module.exports = {
  createSession,
  getSession,
  deleteSession,
  setStreamId,
  getStreamId
};