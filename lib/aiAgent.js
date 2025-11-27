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
    console.log('Attempting to connect to OpenAI Realtime...');
    
    const wsUrl = `${process.env.OPENAI_REALTIME_URL}?model=gpt-4o-realtime-preview-2024-12-17`;
    
    console.log('OpenAI WebSocket URL:', wsUrl);
    
    this.openaiWs = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.openaiWs.on('open', () => {
      console.log('✅ Connected to OpenAI Realtime API');
      
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

      console.log('Session configuration sent');

      // Ask first question
      setTimeout(() => {
        this.askNextQuestion();
      }, 500);
    });

    this.openaiWs.on('message', (msg) => {
      this.handleOpenAIMessage(msg);
    });

    this.openaiWs.on('close', () => {
      console.log('❌ OpenAI WebSocket closed');
    });

    this.openaiWs.on('error', (err) => {
      console.error('❌ OpenAI WebSocket error:', err.message);
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

      // Log all message types for debugging
      if (data.type) {
        console.log('OpenAI message type:', data.type);
      }

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
          console.log('All questions completed, saving to Airtable...');
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
      console.log('No more questions to ask');
      return;
    }

    const question = this.lawyerConfig.questionFlow[this.currentQuestionIndex];
    console.log('Asking question', this.currentQuestionIndex + 1, ':', question);

    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) {
      console.error('OpenAI WebSocket not open, cannot ask question');
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
    console.log('Storing response for question', this.currentQuestionIndex);
    
    // Simple logic to store responses based on question index
    if (this.currentQuestionIndex === 0) {
      this.conversationData.name = transcript;
      console.log('Stored name:', transcript);
    } else if (this.currentQuestionIndex === 1) {
      this.conversationData.phone = transcript;
      console.log('Stored phone:', transcript);
    } else if (this.currentQuestionIndex === 2) {
      this.conversationData.description = transcript;
      console.log('Stored description:', transcript);
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

      // Build fields object - only include non-null values
      const fields = {};
      
      if (this.conversationData.name) {
        fields.Name = String(this.conversationData.name);
      }
      
      if (this.conversationData.phone) {
        fields.Phone = String(this.conversationData.phone);
      }
      
      if (this.conversationData.description) {
        fields.Summary = String(this.conversationData.description);
      }

      console.log('Attempting to save fields:', fields);

      const result = await base(this.lawyerConfig.table).create([
        { fields }
      ]);

      console.log('✅ Lead saved to Airtable successfully:', result[0].id);

      // Post to global webhook
      if (process.env.GLOBAL_WEBHOOK_URL && process.env.GLOBAL_WEBHOOK_URL !== 'https://webhook.site/unique-id-placeholder') {
        try {
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
          console.log('✅ Posted to global webhook');
        } catch (webhookError) {
          console.error('Webhook error (non-critical):', webhookError.message);
        }
      }

      // Say goodbye and hang up
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: 'Say: "Thank you for your information. A lawyer will contact you soon. Goodbye."'
          }
        }));
      }

      // Hang up after 3 seconds
      setTimeout(() => {
        this.hangup();
      }, 3000);

    } catch (error) {
      console.error('❌ Error saving to Airtable:', error.message);
      if (error.response) {
        console.error('Airtable response:', JSON.stringify(error.response.data, null, 2));
      }
      if (error.statusCode) {
        console.error('Status code:', error.statusCode);
      }
      
      // Still hang up even if save failed
      setTimeout(() => {
        this.hangup();
      }, 1000);
    }
  }

  async hangup() {
    console.log('Hanging up call...');
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
      console.log('✅ Call hung up successfully');
    } catch (error) {
      console.error('❌ Error hanging up:', error.message);
    }
  }

  async cleanup() {
    console.log('Cleaning up AI agent...');
    if (this.openaiWs) {
      this.openaiWs.close();
    }
  }
}

module.exports = { AIAgent };