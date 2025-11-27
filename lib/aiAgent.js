const WebSocket = require('ws');

class AIAgent {
  constructor(callId, openaiKey, onAudioToTelnyx) {
    console.log('AIAgent constructor - Call ID:', callId);
    this.callId = callId;
    this.openaiKey = openaiKey;
    this.ws = null;
    this.onAudioToTelnyx = onAudioToTelnyx;
    this.onTranscript = null;
  }

  async connect() {
    console.log('=== CONNECTING TO OPENAI ===');
    
    const url = `${process.env.OPENAI_REALTIME_URL}?model=gpt-4o-realtime-preview-2024-12-17`;
    console.log('OpenAI URL:', url);
    
    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.ws.on('open', () => {
      console.log('SUCCESS: Connected to OpenAI Realtime');
      console.log('Call ID:', this.callId);
      
      console.log('Configuring session...');
      this.ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'You are a helpful legal intake assistant. Ask questions clearly and briefly, then wait for responses.',
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

      console.log('Session configured successfully');
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
      console.log('OpenAI WebSocket closed for call:', this.callId);
    });

    this.ws.on('error', (err) => {
      console.log('ERROR: OpenAI WebSocket error:', err.message);
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

  async handleMessage(msg) {
    if (msg.type) {
      console.log('OpenAI event:', msg.type);
    }

    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = msg.transcript;
      console.log('TRANSCRIPT:', transcript);
      
      if (this.onTranscript) {
        this.onTranscript(transcript);
      }
    }

    if (msg.type === 'response.audio.delta') {
      if (msg.delta && this.onAudioToTelnyx) {
        this.onAudioToTelnyx(msg.delta);
      }
    }

    if (msg.type === 'response.audio.done') {
      console.log('Audio response complete');
    }

    if (msg.type === 'error') {
      console.log('ERROR from OpenAI:', msg.error);
    }
  }

  sendTextResponseAsAudio(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('ERROR: Cannot send, WebSocket not open');
      return;
    }

    console.log('SENDING AS AUDIO:', text);
    
    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: `Say exactly: "${text}"`
      }
    }));
  }

  close() {
    console.log('Closing AIAgent...');
    try {
      if (this.ws) {
        this.ws.close();
      }
    } catch (e) {
      console.log('ERROR closing WebSocket:', e.message);
    }
  }
}

module.exports = AIAgent;