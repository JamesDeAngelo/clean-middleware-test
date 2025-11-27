const AIAgent = require('./aiAgent');
const axios = require('axios');
const Airtable = require('airtable');

class TelnyxHandler {
  constructor(telnyxWs, streamSid, callId, openaiKey, stateMachine) {
    this.telnyxWs = telnyxWs;
    this.streamSid = streamSid;
    this.callId = callId;
    this.openaiKey = openaiKey;
    this.stateMachine = stateMachine;

    this.ai = new AIAgent(callId, openaiKey, (audioBase64) => {
      // Forward base64 audio chunk back to Telnyx
      if (this.telnyxWs.readyState === 1) { // WebSocket.OPEN
        this.telnyxWs.send(JSON.stringify({
          event: 'media',
          stream_sid: this.streamSid,
          media: { payload: audioBase64 }
        }));
      }
    });

    this.ai.onTranscript = async (transcript) => {
      console.log('Transcript received:', transcript);
      
      // Run the state machine with transcript
      const res = this.stateMachine.processResponse(transcript);
      
      if (res.complete) {
        console.log('Conversation complete, saving data...');
        
        // Save to Airtable
        await this.saveToAirtable(res.data);
        
        // Say goodbye
        this.ai.sendTextResponseAsAudio('Thank you for your information. A lawyer will contact you soon. Goodbye.');
        
        // Hangup after 3 seconds
        setTimeout(() => {
          this.hangup();
        }, 3000);
      } else if (res.nextPrompt) {
        console.log('Asking next question:', res.nextPrompt);
        // Instruct AI to speak the nextPrompt (TTS)
        this.ai.sendTextResponseAsAudio(res.nextPrompt);
      } else if (res.error) {
        this.ai.sendTextResponseAsAudio('I didn\'t catch that, please repeat.');
      }
    };
  }

  async connect() {
    await this.ai.connect();
  }

  handleInboundAudio(base64Payload) {
    // Forward inbound audio to OpenAI
    this.ai.appendAudioToOpenAI(base64Payload);
  }

  async saveToAirtable(data) {
    try {
      const config = this.stateMachine.lawyerConfig;
      const base = new Airtable({ apiKey: config.airtableKey }).base(config.baseId);

      const fields = {
        Name: data.name || 'Unknown',
        Phone: data.phone || 'Unknown',
        Summary: data.description || 'No description provided'
      };

      console.log('Saving to Airtable:', fields);

      const result = await base(config.table).create([{ fields }]);
      
      console.log('✅ Saved to Airtable:', result[0].id);

      // Post to global webhook if configured
      if (process.env.GLOBAL_WEBHOOK_URL && 
          process.env.GLOBAL_WEBHOOK_URL !== 'https://webhook.site/unique-id-placeholder') {
        try {
          await axios.post(process.env.GLOBAL_WEBHOOK_URL, {
            type: 'lead',
            format: 'clean',
            data: {
              summary: data.description,
              lead: data,
              transcript: null,
              extras: {}
            }
          });
          console.log('✅ Posted to global webhook');
        } catch (err) {
          console.error('Webhook error:', err.message);
        }
      }
    } catch (error) {
      console.error('❌ Error saving to Airtable:', error.message);
      if (error.response) {
        console.error('Airtable response:', error.response.data);
      }
    }
  }

  async hangup() {
    try {
      await axios.post(
        `https://api.telnyx.com/v2/calls/${this.callId}/actions/hangup`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('✅ Call hung up');
    } catch (error) {
      console.error('❌ Error hanging up:', error.message);
    }
  }

  close() {
    try {
      if (this.ai) {
        this.ai.close();
      }
    } catch (e) {
      console.error('Error closing AI agent:', e);
    }
  }
}

module.exports = TelnyxHandler;