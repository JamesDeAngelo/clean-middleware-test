const logger = require('./utils/logger');
const axios = require('axios');

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2/calls';

class AudioBuffer {
  constructor() {
    this.buffers = new Map(); // callId -> { chunks: [], isPlaying: false }
  }

  addChunk(callId, base64Audio) {
    if (!this.buffers.has(callId)) {
      this.buffers.set(callId, { chunks: [], isPlaying: false });
    }
    
    const buffer = this.buffers.get(callId);
    buffer.chunks.push(base64Audio);
  }

  async flushBuffer(callId, callControlId) {
    const buffer = this.buffers.get(callId);
    
    if (!buffer || buffer.chunks.length === 0) {
      return;
    }

    // Combine all audio chunks
    const combinedAudio = buffer.chunks.join('');
    buffer.chunks = [];
    
    logger.info(`🔊 Playing ${combinedAudio.length} bytes of audio via Telnyx API`);

    try {
      // Use Telnyx's play_audio API with base64 G.711 audio
      await axios.post(
        `${TELNYX_API_URL}/${callControlId}/actions/playback_start`,
        {
          audio_url: `data:audio/x-mulaw;base64,${combinedAudio}`,
          overlay: false
        },
        {
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('✓ Audio playback started');
      
    } catch (error) {
      logger.error(`Failed to play audio: ${error.message}`);
      if (error.response) {
        logger.error(`Telnyx error: ${JSON.stringify(error.response.data)}`);
      }
    }
  }

  clearBuffer(callId) {
    this.buffers.delete(callId);
  }
}

module.exports = new AudioBuffer();