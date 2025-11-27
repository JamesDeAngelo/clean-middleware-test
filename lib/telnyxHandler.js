const AIAgent = require('./aiAgent');
const axios = require('axios');
const Airtable = require('airtable');

class TelnyxHandler {
  constructor(telnyxWs, streamSid, callId, openaiKey, stateMachine) {
    console.log('TelnyxHandler constructor called');
    this.telnyxWs = telnyxWs;
    this.streamSid = streamSid;
    this.callId = callId;
    this.openaiKey = openaiKey;
    this.stateMachine = stateMachine;

    console.log('Creating AIAgent...');
    this.ai = new AIAgent(callId, openaiKey, (audioBase64) => {
      if (this.telnyxWs.readyState === 1) {
        this.telnyxWs.send(JSON.stringify({
          event: 'media',
          stream_sid: this.streamSid,
          media: { payload: audioBase64 }
        }));
      }
    });

    this.ai.onTranscript = async (transcript) => {
      console.log('=== TRANSCRIPT RECEIVED ===');
      console.log('Text:', transcript);
      
      const res = this.stateMachine.processResponse(transcript);
      
      if (res.complete) {
        console.log('=== CONVERSATION COMPLETE ===');
        console.log('Final data:', res.data);
        
        await this.saveToAirtable(res.data);
        
        this.ai.sendTextResponseAsAudio('Thank you for your information. A lawyer will contact you soon. Goodbye.');
        
        setTimeout(() => {
          this.hangup();
        }, 3000);
      } else if (res.nextPrompt) {
        console.log('=== ASKING NEXT QUESTION ===');
        console.log('Question:', res.nextPrompt);
        this.ai.sendTextResponseAsAudio(res.nextPrompt);
      } else if (res.error) {
        this.ai.sendTextResponseAsAudio('I didn\'t catch that, please repeat.');
      }
    };

    console.log('TelnyxHandler setup complete');
  }

  async connect() {
    console.log('TelnyxHandler connecting AI agent...');
    await this.ai.connect();
  }

  handleInboundAudio(base64Payload) {
    this.ai.appendAudioToOpenAI(base64Payload);
  }

  async saveToAirtable(data) {
    console.log('=== SAVING TO AIRTABLE ===');
    try {
      const config = this.stateMachine.lawyerConfig;
      const base = new Airtable({ apiKey: config.airtableKey }).base(config.baseId);

      const fields = {
        Name: data.name || 'Unknown',
        Phone: data.phone || 'Unknown',
        Summary: data.description || 'No description'
      };

      console.log('Fields to save:', fields);

      const result = await base(config.table).create([{ fields }]);
      
      console.log('SUCCESS: Saved to Airtable, ID:', result[0].id);

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
          console.log('SUCCESS: Posted to global webhook');
        } catch (err) {
          console.log('WARNING: Webhook failed:', err.message);
        }
      }
    } catch (error) {
      console.log('ERROR: Failed to save to Airtable:', error.message);
      if (error.response) {
        console.log('Airtable error details:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }

  async hangup() {
    console.log('=== HANGING UP CALL ===');
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
      console.log('SUCCESS: Call hung up');
    } catch (error) {
      console.log('ERROR: Failed to hang up:', error.message);
    }
  }

  close() {
    console.log('Closing TelnyxHandler...');
    try {
      if (this.ai) {
        this.ai.close();
      }
    } catch (e) {
      console.log('ERROR closing AI agent:', e.message);
    }
  }
}

module.exports = TelnyxHandler;