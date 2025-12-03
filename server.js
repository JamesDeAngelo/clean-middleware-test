const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { handleWebhook } = require('./telnyx');
const { setupMediaStreamWebSocket } = require('./mediaStream');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server on the same HTTP server
const wss = new WebSocket.Server({ 
  server, 
  path: '/media-stream' 
});

// Setup media stream WebSocket handling
setupMediaStreamWebSocket(wss);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Telnyx webhook endpoint
app.post('/webhook/telnyx', handleWebhook);

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`HTTP server listening on port ${PORT}`);
  logger.info(`WebSocket server ready at /media-stream`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});