// lib/telnyxHandler.js
const WebSocket = require('ws');
const AIAgent = require('./aiAgent');
const axios = require('axios');

class TelnyxHandler {
  constructor(stateMachine) {
    this.stateMachine = stateMachine;
    this.sessions = new Map(); // callId -> { aiAgent, telnyxWs, streamSid }
  }

  // Called when Telnyx connects to /media-stream
  handleConnection(telnyxWs) {
    telnyxWs.on('message', async (msg) => {
      let data;
      try {
        data = JSON.parse(msg.toString());
      } catch (err) {
        console.error('Invalid Telnyx WS message:', err, msg.toString());
        return;
      }

      switch (data.event) {
        case 'start':
          await this.handleStart(telnyxWs, data);
          break;

        case 'media':
          await this.handleMedia(data);
          break;

        case 'stop':
          await this.handleStop(data);
          break;

        case 'hangup':
          await this.handleHangup(data);
          break;

        default:
          console.log('Telnyx WS unknown event:', data.event);
      }
    });

    telnyxWs.on('close', () => console.log('Telnyx WS closed'));
    telnyxWs.on('error', (err) => console.error('Telnyx WS error:', err));
  }

  async handleStart(telnyxWs, data) {
    const { stream_sid, call_control_id } = data;
    console.log('Telnyx stream started:', stream_sid, call_control_id);

    // Create AIAgent for this call
    const ai = new AIAgent(call_control_id, process.env.OPENAI_API_KEY, (audioBase64) => {
      // forward AI audio delta to Telnyx
      telnyxWs.send(JSON.stringify({
        event: 'media',
        stream_sid,
        media: { payload: audioBase64 }
      }));
    });

    ai.onTranscript = async (transcript) => {
      // run your state machine
      const res = this.stateMachine.processResponse(transcript);

      if (res.complete) {
        ai.sendTextResponseAsAudio('Thank you — a lawyer will contact you. Goodbye.');
        setTimeout(() => this.hangupCall(call_control_id), 1500);
      } else if (res.nextPrompt) {
        ai.sendTextResponseAsAudio(res.nextPrompt);
      } else if (res.error) {
        ai.sendTextResponseAsAudio('I didn\'t catch that, please repeat.');
      }
    };

    await ai.connect();

    // save session
    this.sessions.set(call_control_id, { aiAgent: ai, telnyxWs, streamSid });
  }

  async handleMedia(data) {
    const { stream_sid, media } = data;
    const session = [...this.sessions.values()].find(s => s.streamSid === stream_sid);
    if (!session) {
      console.error('No session found for stream_sid', stream_sid);
      return;
    }

    // forward inbound audio to AI
    session.aiAgent.appendAudioToOpenAI(media.payload);
  }

  async handleStop(data) {
    const { stream_sid } = data;
    const session = [...this.sessions.values()].find(s => s.streamSid === stream_sid);
    if (!session) return;

    // commit audio to OpenAI for final transcription
    session.aiAgent.commitAudio();
  }

  async handleHangup(data) {
    const { call_control_id } = data;
    const session = this.sessions.get(call_control_id);
    if (!session) return;

    session.aiAgent.close();
    this.sessions.delete(call_control_id);
    console.log('Session ended for call:', call_control_id);
  }

  async hangupCall(call_control_id) {
    const session = this.sessions.get(call_control_id);
    if (!session) return;

    const url = `https://api.telnyx.com/v2/calls/${call_control_id}/actions/hangup`;
    try {
      await axios.post(url, {}, {
        headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }
      });
      console.log('Call hung up via Telnyx:', call_control_id);
    } catch (err) {
      console.error('Error hanging up call:', err);
    }
  }
}

module.exports = TelnyxHandler;
