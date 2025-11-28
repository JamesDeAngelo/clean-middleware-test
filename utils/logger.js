function info(message) {
  console.log(`[${new Date().toISOString()}] INFO: ${message}`);
}

function error(message) {
  console.log(`[${new Date().toISOString()}] ERROR: ${message}`);
}

function warn(message) {
  console.log(`[${new Date().toISOString()}] WARN: ${message}`);
}

module.exports = { info, error, warn };