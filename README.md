# Zeta Cloud Streaming Server

WebRTC signaling server for remote Android camera streaming.

## Features
- Remote access from anywhere
- TURN server support for NAT traversal
- Multi-viewer support
- Auto-reconnect
- 100% free hosting

## Deployment

### Render.com
1. Fork this repository
2. Connect to Render.com
3. Deploy as Web Service
4. Done!

### Configuration
Update the WebSocket URL in:
- Android app: `ZetaRelayService.java` line 17
- Viewer page: `public/index.html` line 306

Set both to: `wss://your-app.onrender.com/ws`

## Usage
1. Start Android app
2. Open https://your-app.onrender.com in browser
3. Video should stream!

## Tech Stack
- Node.js + Express
- WebSocket (ws)
- WebRTC
- Free TURN servers from Metered.ca
