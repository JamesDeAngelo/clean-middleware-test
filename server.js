require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const LAWYER_CONFIGS = require('./config/lawyers');
const TelnyxHandler = require('./lib/telnyxHandler');

const app = express();
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const activeSessions = new Map();

app.get('/', (req, res) => {
  res.send('AI Voice Agent - v3.0 FIXED');
});

app.post('/telnyx-webhook', async (req, res) => {
  try {
    const payload = req.body;
    const eventType = payload.data?.event_type;
    const callControlId = payload.data?.payload?.call_control_id;
    const toNumber = payload.data?.payload?.to;
    const fromNumber = payload.data?.payload?.from;

    console.log('====================================');
    console.log('WEBHOOK EVENT:', eventType);
    console.log('To:', toNumber, '| From:', fromNumber);
    console.log('Call ID:', callControlId);
    console.log('====================================');

    if (eventType === 'call.initiated' || eventType === 'call.answered') {
      const lawyerConfig = LAWYER_CONFIGS[toNumber];
      
      if (!lawyerConfig) {
        console.log('ERROR: No lawyer config for:', toNumber);
        return res.status(400).send('No config');
      }

      console.log('>>> Answering call...');
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
      console.log('>>> Call answered');

      const streamUrl = `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/media-stream`;
      console.log('>>> Starting stream to:', streamUrl);
      
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
      console.log('>>> Stream started');

      activeSessions.set(callControlId, {
        callControlId,
        lawyerConfig,
        fromNumber,
        toNumber
      });
    }

    res.status(200).send({ status: 'ok' });
  } catch (error) {
    console.log('ERROR in webhook:', error.message);
    res.status(500).send('Error');
  }
});


//
// ============================================================================
// REPLACED SECTION: FULL NEW wss.on("connection")
// ============================================================================
//

wss.on('connection', (ws) => {
  console.log('\n====================================');
  console.log('WEBSOCKET CONNECTED');
  console.log('====================================\n');
  
  let streamSid = null;
  let callControlId = null;
  let telnyxHandler = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Log the raw message to see what Telnyx is actually sending
      console.log('RAW WEBSOCKET MESSAGE:', JSON.stringify(data, null, 2));

      if (data.event === 'start') {
        // Try multiple possible fields where Telnyx might send IDs
        streamSid = data.stream_sid || data.streamSid || data.start?.stream_sid;
        callControlId = data.call_control_id || data.callControlId || data.start?.call_control_id;
        
        // If still not found, look in metadata or custom parameters
        if (!callControlId && data.start?.custom_headers) {
          callControlId = data.start.custom_headers.call_control_id;
        }
        
        console.log('STREAM START');
        console.log('Stream SID:', streamSid);
        console.log('Call ID:', callControlId);
        console.log('All data keys:', Object.keys(data));

        // Try to find session by any available ID
        let sessionInfo = null;
        
        if (callControlId) {
          sessionInfo = activeSessions.get(callControlId);
        }
        
        // If not found, try to match by checking all active sessions
        if (!sessionInfo && activeSessions.size > 0) {
          console.log('Trying to match from active sessions...');
          console.log('Active sessions:', Array.from(activeSessions.keys()));
          
          // Get the most recent session (likely the one we just created)
          const sessions = Array.from(activeSessions.values());
          sessionInfo = sessions[sessions.length - 1];
          
          if (sessionInfo) {
            console.log('Using most recent session:', sessionInfo.callControlId);
            callControlId = sessionInfo.callControlId;
          }
        }
        
        if (!sessionInfo) {
          console.log('ERROR: No session found');
          console.log('Available sessions:', Array.from(activeSessions.keys()));
          return;
        }

        const stateMachine = {
          currentStep: 0,
          data: {},
          lawyerConfig: sessionInfo.lawyerConfig,
          processResponse: function(transcript) {
            console.log('\n>>> PROCESSING:', transcript);
            
            const questions = this.lawyerConfig.questionFlow;
            
            if (this.currentStep === 0) {
              this.data.name = transcript;
            } else if (this.currentStep === 1) {
              this.data.phone = transcript;
            } else if (this.currentStep === 2) {
              this.data.description = transcript;
            }

            this.currentStep++;

            if (this.currentStep >= questions.length) {
              console.log('>>> COMPLETE!');
              return { complete: true, data: this.data };
            }

            console.log('>>> NEXT QUESTION:', questions[this.currentStep]);
            return { 
              nextPrompt: questions[this.currentStep],
              complete: false 
            };
          }
        };

        telnyxHandler = new TelnyxHandler(
          ws,
          streamSid,
          callControlId,
          process.env.OPENAI_API_KEY,
          stateMachine
        );

        await telnyxHandler.connect();
      }

      if (data.event === 'media' && telnyxHandler) {
        telnyxHandler.handleInboundAudio(data.media.payload);
      }

      if (data.event === 'stop') {
        console.log('STREAM STOPPED');
        if (telnyxHandler) {
          telnyxHandler.close();
        }
        if (callControlId) {
          activeSessions.delete(callControlId);
        }
      }

    } catch (error) {
      console.log('ERROR in message:', error.message);
      console.log('Stack:', error.stack);
    }
  });

  ws.on('close', () => {
    console.log('WEBSOCKET CLOSED');
    if (telnyxHandler) {
      telnyxHandler.close();
    }
  });

  ws.on('error', (error) => {
    console.log('WEBSOCKET ERROR:', error.message);
  });
});


//
// ============================================================================
// END OF REPLACED SECTION
// ============================================================================
//


server.on('upgrade', (request, socket, head) => {
  if (request.url === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n========================================');
  console.log('SERVER STARTED - v3.0');
  console.log('Port:', PORT);
  console.log('WebSocket: wss://' + process.env.RENDER_EXTERNAL_HOSTNAME + '/media-stream');
  console.log('========================================\n');
});
