require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const telnyx = require('./telnyx');
const mediaStream = require('./mediaStream');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/webhook/telnyx', async (req, res) => {
  try {
    await telnyx.handleWebhook(req, res);
  } catch (error) {
    logger.error(`Webhook error: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/media-stream', async (req, res) => {
  try {
    await mediaStream.handleMediaStream(req, res);
  } catch (error) {
    logger.error(`Media stream error: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});