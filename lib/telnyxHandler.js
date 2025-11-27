const axios = require('axios');
const { AIAgent } = require('./aiAgent');
const LAWYER_CONFIGS = require('../config/lawyers');

async function handleIncomingCall(req, res, activeSessions) {
  try {
    const payload = req.body;
    const eventType = payload.data?.event_type;
    const lawyerPhone = payload.data?.payload?.to;
    const callControlId = payload.data?.payload?.call_control_id;
    const fromNumber = payload.data?.payload?.from;

    console.log('Telnyx event:', eventType);
    console.log('Incoming call to:', lawyerPhone);
    console.log('From:', fromNumber);
    console.log('Call Control ID:', callControlId);

    // Only process call.answered events
    if (eventType !== 'call.answered') {
      return res.status(200).send({ status: 'ignored' });
    }

    const lawyerConfig = LAWYER_CONFIGS[lawyerPhone];

    if (!lawyerConfig) {
      console.error('No config for number:', lawyerPhone);
      return res.status(400).send('No config for this number');
    }

    // Answer the call
    try {
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('Call answered');
    } catch (error) {
      console.error('Error answering call:', error.response?.data || error.message);
    }

    // Start media streaming
    const streamUrl = `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/media-stream`;
    
    try {
      await axios.post(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`,
        {
          stream_url: streamUrl,
          stream_track: 'inbound_track'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('Media streaming started to:', streamUrl);

      // Store session info for when WebSocket connects
      activeSessions.set(callControlId, {
        callControlId,
        lawyerConfig,
        fromNumber,
        lawyerPhone,
        startTime: Date.now()
      });

    } catch (error) {
      console.error('Error starting streaming:', error.response?.data || error.message);
    }

    res.status(200).send({ status: 'processing' });
  } catch (error) {
    console.error('Error handling call:', error);
    res.status(500).send('Error processing call');
  }
}

function handleMediaStream(ws, activeSessions) {
  let streamSid = null;
  let callControlId = null;
  let aiAgent = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        streamSid = data.stream_sid;
        callControlId = data.call_control_id;
        
        console.log('Media stream started');
        console.log('Stream SID:', streamSid);
        console.log('Call Control ID:', callControlId);

        // Get session info
        const sessionInfo = activeSessions.get(callControlId);
        
        if (!sessionInfo) {
          console.error('No session info found for call:', callControlId);
          return;
        }

        // Create AI agent for this call
        aiAgent = new AIAgent(
          callControlId,
          streamSid,
          ws,
          sessionInfo.lawyerConfig,
          sessionInfo.fromNumber
        );

        await aiAgent.connect();
      }

      if (data.event === 'media' && aiAgent) {
        // Forward audio to OpenAI
        const audioPayload = data.media.payload;
        aiAgent.sendAudioToOpenAI(audioPayload);
      }

      if (data.event === 'stop') {
        console.log('Media stream stopped');
        if (aiAgent) {
          await aiAgent.cleanup();
        }
        if (callControlId) {
          activeSessions.delete(callControlId);
        }
      }

    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Telnyx WebSocket closed');
    if (aiAgent) {
      aiAgent.cleanup();
    }
    if (callControlId) {
      activeSessions.delete(callControlId);
    }
  });

  ws.on('error', (error) => {
    console.error('Telnyx WebSocket error:', error);
  });
}

module.exports = { handleIncomingCall, handleMediaStream };