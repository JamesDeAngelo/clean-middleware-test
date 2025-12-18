require('dotenv').config();
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
server.listen(PORT, '0.0.0.0', async () => {
  logger.info(`HTTP server listening on port ${PORT}`);
  logger.info(`WebSocket server ready at /media-stream`);
  
  // Safely test Airtable connection
  try {
    const { testAirtableConnection } = require('./airtable');
    logger.info('🔍 Testing Airtable connection...');
    const airtableConnected = await testAirtableConnection();
    
    if (airtableConnected) {
      logger.info('✅ Airtable integration ready!');
    } else {
      logger.error('❌ Airtable connection failed - check your credentials');
    }
  } catch (error) {
    logger.warn(`⚠️ Airtable module not loaded: ${error.message}`);
    logger.warn('Server will run without Airtable integration');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});