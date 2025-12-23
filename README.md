# AI Voice Agent for PI Lawyers

A real-time AI voice agent powered by OpenAI's Realtime API and Telnyx telephony services for personal injury law firms.

## Features

- Real-time voice conversations using OpenAI GPT-4o
- Telnyx telephony integration
- WebSocket-based audio streaming
- Professional lawyer intake assistant
- Session management for multiple concurrent calls

## Prerequisites

- Node.js 18+ installed
- Telnyx account with phone number
- OpenAI API key with Realtime API access
- (Optional) Render.com account for deployment

## Installation

1. Clone the repository:
```bash
git clone https://github.com/JamesDeAngelo/clean-middleware-test.git
cd clean-middleware-test
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from template:
```bash
cp .env.example .env
```

4. Configure your `.env` file with actual credentials:
```env
OPENAI_API_KEY=sk-proj-...
TELNYX_API_KEY=KEY...
RENDER_EXTERNAL_HOSTNAME=your-app.onrender.com
RENDER_URL=wss://your-app.onrender.com
PORT=3000
```

## Local Development

1. Start the server:
```bash
npm start
```

2. Use ngrok or similar tool to expose your local server:
```bash
ngrok http 3000
```

3. Configure Telnyx webhook to point to your ngrok URL:
```
https://your-ngrok-url.ngrok.io/webhook/telnyx
```

## Deployment to Render

1. Push code to GitHub

2. Create new Web Service on Render.com

3. Configure environment variables in Render dashboard

4. Set webhook URL in Telnyx:
```
https://your-app.onrender.com/webhook/telnyx
```

5. Deploy and test!

## Configuration

### Telnyx Setup

1. Go to Telnyx Portal → Voice → Call Control Applications
2. Create new application
3. Set Webhook URL: `https://your-app.onrender.com/webhook/telnyx`
4. Set Webhook API Version: V2
5. Assign phone number to this application

### OpenAI Setup

1. Get API key from OpenAI platform
2. Ensure Realtime API access is enabled
3. Add key to `.env` file

## Architecture

```
Caller → Telnyx Phone System → Your Server
                                    ↓
                            Webhook Handler
                                    ↓
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
            OpenAI WebSocket              Telnyx Media Stream
            (AI Processing)                (Audio I/O)
                    ↓                               ↓
                    └───────────────┬───────────────┘
                                    ↓
                            Session Management
```

## File Structure

```
├── server.js              # Main HTTP/WebSocket server
├── telnyx.js             # Telnyx webhook handling
├── websocket.js          # OpenAI WebSocket management
├── openai.js             # OpenAI API configuration
├── mediaStream.js        # Audio streaming handler
├── utils/
│   ├── logger.js         # Logging utility
│   └── sessionStore.js   # Session management
├── .env                  # Environment configuration
├── package.json          # Dependencies
└── README.md            # This file
```

## API Endpoints

- `GET /health` - Health check endpoint
- `POST /webhook/telnyx` - Telnyx webhook receiver
- `WS /media-stream` - WebSocket for audio streaming

## Troubleshooting

### Issue: Calls not connecting

**Solution:**
- Check Telnyx webhook URL is correct
- Verify TELNYX_API_KEY is valid
- Check server logs for errors

### Issue: No audio from AI

**Solution:**
- Verify OPENAI_API_KEY is valid
- Check OpenAI WebSocket connection in logs
- Ensure audio format is set to PCM16

### Issue: WebSocket connection fails

**Solution:**
- Use `wss://` not `https://` for WebSocket URLs
- Verify RENDER_URL ends without trailing slash
- Check firewall/security group settings

### Issue: Server crashes on startup

**Solution:**
- Run `npm install` to ensure all dependencies are installed
- Check that all required environment variables are set
- Review server logs for specific error messages

## Key Fixes Applied

1. **Fixed logger syntax errors** in server.js
2. **Fixed OpenAI payload structure** - Changed `session.configure` to `session.update`
3. **Fixed audio forwarding** - Used `msg.delta` instead of `msg.audio`
4. **Added missing `updateSession` function** to sessionStore
5. **Fixed WebSocket URL protocol** - Ensured `wss://` usage
6. **Added missing `pino-pretty`** dependency
7. **Fixed OpenAI event types** for realtime API
8. **Added comprehensive error logging**

## Testing

1. Call your Telnyx number
2. Check server logs for connection events
3. Speak to the AI agent
4. Verify responses are natural and appropriate

## Support

For issues or questions:
- Check logs: `tail -f logs/app.log`
- Review Telnyx dashboard for call logs
- Check OpenAI usage dashboard

## License

ISC


