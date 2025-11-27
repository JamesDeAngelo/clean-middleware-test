const WebSocket = require('ws');

class AIAgent {
  constructor(callId, openaiKey, onAudioToTelnyx) {
    this.callId = callId;
    this.openaiKey = openaiKey;
    this.ws = null;
    this.onAudioToTelnyx = onAudioToTelnyx;
    this.onTranscript = null;
  }

  async connect() {
    console.log('Connecting to OpenAI Realtime API...');
    
    const url = `${process.env.OPENAI_REALTIME_URL}?model=gpt-4o-realtime-preview-2024-12-17`;
    
    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.ws.on('open', () => {
      console.log('✅ OpenAI Realtime connected for call:', this.callId);
      
      // Configure session
      this.ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'You are a helpful legal intake assistant. Ask questions clearly and concisely, then wait for the caller to respond. Keep responses brief.',
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      }));

      console.log('Session configured, ready to receive audio');
    });

    this.ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.on('close', () => {
      console.log('OpenAI Realtime closed for call:', this.callId);
    });

    this.ws.on('error', (err) => {
      console.error('OpenAI WebSocket error:', err.message);
    });
  }

  appendAudioToOpenAI(base64Payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Payload
    }));
  }

  commitAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  async handleMessage(msg) {
    // Log message types for debugging
    if (msg.type) {
      console.log('OpenAI message type:', msg.type);
    }

    // Handle transcription
    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = msg.transcript;
      console.log('📝 Transcript:', transcript);
      
      if (this.onTranscript) {
        this.onTranscript(transcript);
      }
    }

    // Forward audio deltas to Telnyx
    if (msg.type === 'response.audio.delta') {
      if (msg.delta && this.onAudioToTelnyx) {
        this.onAudioToTelnyx(msg.delta);
      }
    }

    // Audio response complete
    if (msg.type === 'response.audio.done') {
      console.log('✅ Audio response complete');
    }

    // Handle errors
    if (msg.type === 'error') {
      console.error('❌ OpenAI error:', msg.error);
    }
  }

  sendTextResponseAsAudio(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('Cannot send response, WebSocket not open');
      return;
    }

    console.log('🎤 Sending text as audio:', text);
    
    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: `Say exactly: "${text}"`
      }
    }));
  }

  close() {
    try {
      if (this.ws) {
        this.ws.close();
      }
    } catch (e) {
      console.error('Error closing WebSocket:', e);
    }
  }
}

module.exports = AIAgent;