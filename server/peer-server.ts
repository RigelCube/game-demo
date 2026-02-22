import { PeerServer } from "peer";

const peerServer = PeerServer({ 
  port: 3002, 
  path: "/" 
});

peerServer.on('connection', (client: {getId: () => string}) => {
  console.log(`WebRTC Client connected: ${client.getId()}`);
});

console.log("RTC Signaling Server running on port 3002");
