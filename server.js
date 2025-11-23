const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('🚀 Voice API Test Running!');
});

// Voice API webhook
app.post('/telnyx-webhook', async (req, res) => {
  try {
    const { data } = req.body;
    const eventType = data?.event_type;
    
    console.log(`📞 Event: ${eventType}`);
    console.log('Full payload:', JSON.stringify(req.body, null, 2));
    
    if (eventType === 'call.initiated') {
      const callControlId = data.payload.call_control_id;
      const from = data.payload.from;
      
      console.log(`✅ New call from ${from}`);
      console.log(`🆔 Call Control ID: ${callControlId}`);
      
      // Answer the call
      await answerCall(callControlId);
      
      // Wait a moment, then speak
      setTimeout(async () => {
        await speakToCall(callControlId, "Hello! This is a test. If you can hear this, Voice API is working correctly.");
      }, 1000);
      
      res.status(200).send('OK');
      
    } else if (eventType === 'call.answered') {
      console.log('📞 Call answered');
      res.status(200).send('OK');
      
    } else if (eventType === 'call.hangup') {
      console.log('👋 Call ended');
      res.status(200).send('OK');
      
    } else {
      console.log(`ℹ️ Other event: ${eventType}`);
      res.status(200).send('OK');
    }
    
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(200).send('OK');
  }
});

// Answer call
async function answerCall(callControlId) {
  try {
    console.log(`📞 Answering call: ${callControlId}`);
    
    const response = await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Call answered successfully');
    return response.data;
    
  } catch (error) {
    console.error('❌ Answer error:', error.response?.data || error.message);
    throw error;
  }
}

// Speak to caller
async function speakToCall(callControlId, text) {
  try {
    console.log(`🗣️ Speaking: "${text}"`);
    
    const response = await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
      {
        payload: text,
        voice: 'female',
        language: 'en-US'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Speaking successfully');
    return response.data;
    
  } catch (error) {
    console.error('❌ Speak error:', error.response?.data || error.message);
    throw error;
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 VOICE API TEST SERVER STARTED');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`📞 Webhook: /telnyx-webhook`);
  console.log(`🔑 Telnyx API Key: ${process.env.TELNYX_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log('========================================');
});
