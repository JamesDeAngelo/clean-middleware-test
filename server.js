app.post('/texml-webhook', (req, res) => {
  const event = req.body.CallbackSource || 'initial';
  console.log(`📞 Event received: ${event}`);
  console.log(JSON.stringify(req.body, null, 2));

  // Always respond with a Speak command for the initial call
  const texmlResponse = `
    <Response>
      <Speak>Hi! This is your AI speaking. Welcome to your call.</Speak>
      <Pause length="10"/>
    </Response>
  `;

  res.set('Content-Type', 'application/xml');
  res.send(texmlResponse);
});
