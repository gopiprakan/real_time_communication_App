# Connect - Real-World Real-Time Communication Platform

A production-ready video conferencing application with real WebRTC peer-to-peer connectivity, Socket.io signaling, and media handling.

## 🚀 Key Features (Real Implementation)

- **Actual WebRTC**: Uses `RTCPeerConnection` for real-time video/audio streaming between peers (not simulated).
- **Socket.io Signaling**: A dedicated Node.js signaling server handles room management and WebRTC handshakes (Offers, Answers, ICE Candidates).
- **Network Resilience**: Integrated with Google STUN servers to bypass NATs and firewalls, ensuring connectivity across different networks.
- **Screen Sharing**: Real system-level screen sharing using the `getDisplayMedia` API with automatic stream recovery.
- **Dynamic Mesh Network**: Supports multiple participants in a room using a mesh architecture.
- **Production UI**: Premium, responsive interface with real-time feedback, media toggles, and chat.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JS (ES6+), WebRTC API, HTML5, CSS3
- **Icons/Fonts**: Lucide Icons, Inter Font

## 📦 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Server
```bash
npm start
```
The application will be available at `http://localhost:3000`.

## 🌐 Real-World Usage
To use this across different machines or over the internet:
1. Deploy the Node.js server to a platform like Heroku, Render, or a VPS.
2. Ensure you use `https` for camera/microphone access (required by browsers).
3. The app is configured with STUN servers, so it will work across most standard networks.

## 🧪 Testing
1. Start the server.
2. Open the app in two different browser tabs (or two different devices if hosted).
3. Log in and "Start Meeting" on one, then copy the Room ID.
4. "Join Meeting" on the other using that ID.
5. You will see real p2p video streams between the tabs.
