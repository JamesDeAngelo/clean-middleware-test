const WebSocket = require('ws');
const axios = require('axios');
const Airtable = require('airtable');

class AIAgent {
  constructor(callControlId, streamSid, telnyxWs, lawyerConfig, fromNumber) {
    this.callControlId = callControlId;
    this.streamSid = streamSid;
    this.telnyxWs = telnyxWs;
    this.lawyerConfig = lawyerConfig;
    this.fromNumber = fromNumber;
    this.openaiWs = null;
    this.conversationData = {
      name: null,
      phone: fromNumber,
      description: null
    };
    this.currentQuestionIndex = 0;
    this.transcript = [];
  }

  async connect() {
    const wsUrl = `${process.env.OPENAI_REALTIME_URL}?model=gpt-4o-realtime-preview-2024-12-17`;
    
    this.openaiWs = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.openaiWs.on('open', () => {
      console.log('Connected to OpenAI Realtime API');
      
      // Configure session
      this.openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'You are a helpful legal intake assistant. Ask questions clearly and wait for responses.',
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

      // Ask first question
      this.askNextQuestion();
    });

    this.openaiWs.on('message', (msg) => {
      this.handleOpenAIMessage(msg);
    });

    this.openaiWs.on('close', () => {
      console.log('OpenAI WebSocket closed');
    });

    this.openaiWs.on('error', (err) => {
      console.error('OpenAI WebSocket error:', err);
    });
  }

  sendAudioToOpenAI(base64Audio) {
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    this.openaiWs.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    }));
  }

  handleOpenAIMessage(msg) {
    try {
      const data = JSON.parse(msg);

      // Handle audio output from OpenAI
      if (data.type === 'response.audio.delta') {
        this.sendAudioToTelnyx(data.delta);
      }

      // Handle transcript
      if (data.type === 'conversation.item.input_audio_transcription.completed') {
        const transcript = data.transcript;
        console.log('User said:', transcript);
        this.transcript.push({ role: 'user', text: transcript });
        
        // Store the response based on current question
        this.storeResponse(transcript);
      }

      // Handle completion
      if (data.type === 'response.done') {
        console.log('AI response completed');
        
        // Move to next question
        this.currentQuestionIndex++;
        
        if (this.currentQuestionIndex < this.lawyerConfig.questionFlow.length) {
          // Ask next question after a short delay
          setTimeout(() => {
            this.askNextQuestion();
          }, 1000);
        } else {
          // All questions answered - save to Airtable
          setTimeout(() => {
            this.saveToAirtable();
          }, 2000);
        }
      }

    } catch (error) {
      console.error('Error handling OpenAI message:', error);
    }
  }

  askNextQuestion() {
    if (this.currentQuestionIndex >= this.lawyerConfig.questionFlow.length) {
      return;
    }

    const question = this.lawyerConfig.questionFlow[this.currentQuestionIndex];
    console.log('Asking question:', question);

    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    this.openaiWs.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: `Ask this question clearly: "${question}"`
      }
    }));
  }

  storeResponse(transcript) {
    // Simple logic to store responses based on question index
    if (this.currentQuestionIndex === 0) {
      this.conversationData.name = transcript;
    } else if (this.currentQuestionIndex === 1) {
      this.conversationData.phone = transcript;
    } else if (this.currentQuestionIndex === 2) {
      this.conversationData.description = transcript;
    }
  }

  sendAudioToTelnyx(base64Audio) {
    if (!this.telnyxWs || this.telnyxWs.readyState !== WebSocket.OPEN) {
      return;
    }

    this.telnyxWs.send(JSON.stringify({
      event: 'media',
      stream_sid: this.streamSid,
      media: {
        payload: base64Audio
      }
    }));
  }

  async saveToAirtable() {
    console.log('Saving to Airtable:', this.conversationData);

    try {
      const base = new Airtable({ apiKey: this.lawyerConfig.airtableKey })
        .base(this.lawyerConfig.baseId);

      await base(this.lawyerConfig.table).create([
        {
          fields: {
            Name: this.conversationData.name || 'Unknown',
            Phone: this.conversationData.phone || 'Unknown',
            Summary: this.conversationData.description || 'No description provided'
          }
        }
      ]);

      console.log('Lead saved to Airtable');

      // Post to global webhook
      if (process.env.GLOBAL_WEBHOOK_URL) {
        await axios.post(process.env.GLOBAL_WEBHOOK_URL, {
          type: 'lead',
          format: 'clean',
          data: {
            summary: this.conversationData.description,
            lead: {
              name: this.conversationData.name,
              phone: this.conversationData.phone
            },
            transcript: this.lawyerConfig.includeTranscript ? this.transcript : null,
            extras: {}
          }
        });
        console.log('Posted to global webhook');
      }

      // Say goodbye and hang up
      this.openaiWs.send(JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: 'Say: "Thank you for your information. A lawyer will contact you soon. Goodbye."'
        }
      }));

      // Hang up after 3 seconds
      setTimeout(() => {
        this.hangup();
      }, 3000);

    } catch (error) {
      console.error('Error saving to Airtable:', error);
    }
  }

  async hangup() {
    try {
      await axios.post(
        `https://api.telnyx.com/v2/calls/${this.callControlId}/actions/hangup`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('Call hung up');
    } catch (error) {
      console.error('Error hanging up:', error);
    }
  }

  async cleanup() {
    if (this.openaiWs) {
      this.openaiWs.close();
    }
  }
}

module.exports = { AIAgent };