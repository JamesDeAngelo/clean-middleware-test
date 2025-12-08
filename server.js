require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { handleWebhook } = require('./telnyx');
const { setupMediaStreamWebSocket } = require('./mediaStream');
const { testConnection, createTestRecord } = require('./airtable');
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

// Airtable test endpoint
app.get('/test-airtable', async (req, res) => {
  try {
    logger.info('🧪 Testing Airtable connection via endpoint...');
    const connected = await testConnection();
    
    if (connected) {
      const testCreated = await createTestRecord();
      
      if (testCreated) {
        res.status(200).json({ 
          status: 'success', 
          message: 'Airtable connection works! Check your table for a test record.' 
        });
      } else {
        res.status(500).json({ 
          status: 'error', 
          message: 'Connected to Airtable but failed to create test record. Check logs.' 
        });
      }
    } else {
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to connect to Airtable. Check your API key and Base ID.' 
      });
    }
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Telnyx webhook endpoint
app.post('/webhook/telnyx', handleWebhook);

// Start the server
server.listen(PORT, '0.0.0.0', async () => {
  logger.info(`HTTP server listening on port ${PORT}`);
  logger.info(`WebSocket server ready at /media-stream`);
  
  // Test Airtable connection on startup
  logger.info('');
  logger.info('🔍 Testing Airtable connection...');
  const connected = await testConnection();
  
  if (connected) {
    logger.info('✅ Airtable is ready!');
  } else {
    logger.error('❌ Airtable connection failed - check your .env variables');
  }
  logger.info('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});