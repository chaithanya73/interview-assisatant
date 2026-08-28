const WebSocket = require('ws');

class SignalingServer {
  constructor(port = 8085) {
    this.port = port;
    this.wss = null;
    this.rooms = new Map(); // roomCode -> Set of ws clients
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });

    console.log(`[Signaling] Server running on ws://localhost:${this.port}`);

    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.roomCode = null;
      ws.peerId = this.generateId();

      console.log(`[Signaling] Client connected: ${ws.peerId}`);

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (err) {
          console.error('[Signaling] Invalid message:', err.message);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        console.log(`[Signaling] Client disconnected: ${ws.peerId}`);
        this.removeFromRoom(ws);
      });

      ws.on('error', (err) => {
        console.error(`[Signaling] Client error: ${ws.peerId}`, err.message);
      });

      // Send welcome with assigned peer ID
      ws.send(JSON.stringify({ type: 'welcome', peerId: ws.peerId }));
    });

    // Heartbeat to clean up dead connections
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          console.log(`[Signaling] Terminating dead client: ${ws.peerId}`);
          this.removeFromRoom(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(this.heartbeatInterval);
    });

    return this.wss;
  }

  handleMessage(ws, message) {
    switch (message.type) {
      case 'create-room':
        this.createRoom(ws);
        break;

      case 'join-room':
        this.joinRoom(ws, message.roomCode);
        break;

      case 'leave-room':
        this.removeFromRoom(ws);
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'request-stream':
        this.relayToPeer(ws, message);
        break;

      case 'screen-share-started':
      case 'screen-share-stopped':
        this.broadcastToRoom(ws, message);
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
    }
  }

  createRoom(ws) {
    // Remove from any existing room
    this.removeFromRoom(ws);

    const roomCode = this.generateRoomCode();
    this.rooms.set(roomCode, new Set([ws]));
    ws.roomCode = roomCode;

    console.log(`[Signaling] Room created: ${roomCode} by ${ws.peerId}`);

    ws.send(JSON.stringify({
      type: 'room-created',
      roomCode,
      peerId: ws.peerId
    }));
  }

  joinRoom(ws, roomCode) {
    if (!roomCode) {
      ws.send(JSON.stringify({ type: 'error', message: 'Room code is required' }));
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = this.rooms.get(code);

    if (!room) {
      ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
      return;
    }

    if (room.size >= 10) {
      ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 10 peers)' }));
      return;
    }

    // Remove from any existing room
    this.removeFromRoom(ws);

    room.add(ws);
    ws.roomCode = code;

    console.log(`[Signaling] ${ws.peerId} joined room: ${code} (${room.size} peers)`);

    // Notify the joiner
    ws.send(JSON.stringify({
      type: 'room-joined',
      roomCode: code,
      peerId: ws.peerId,
      peerCount: room.size
    }));

    // Notify other peers in the room
    this.broadcastToRoom(ws, {
      type: 'peer-joined',
      peerId: ws.peerId,
      peerCount: room.size
    });
  }

  removeFromRoom(ws) {
    if (!ws.roomCode) return;

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.delete(ws);

    // Notify remaining peers
    room.forEach((peer) => {
      peer.send(JSON.stringify({
        type: 'peer-left',
        peerId: ws.peerId,
        peerCount: room.size
      }));
    });

    // Clean up empty rooms
    if (room.size === 0) {
      this.rooms.delete(ws.roomCode);
      console.log(`[Signaling] Room deleted: ${ws.roomCode}`);
    }

    console.log(`[Signaling] ${ws.peerId} left room: ${ws.roomCode}`);
    ws.roomCode = null;
  }

  relayToPeer(ws, message) {
    if (!ws.roomCode) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
      return;
    }

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    const targetPeerId = message.targetPeerId;

    room.forEach((peer) => {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        // If targetPeerId is specified, only send to that peer
        if (targetPeerId && peer.peerId !== targetPeerId) return;

        peer.send(JSON.stringify({
          ...message,
          fromPeerId: ws.peerId
        }));
      }
    });
  }

  broadcastToRoom(ws, message) {
    if (!ws.roomCode) return;

    const room = this.rooms.get(ws.roomCode);
    if (!room) return;

    room.forEach((peer) => {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({
          ...message,
          fromPeerId: ws.peerId
        }));
      }
    });
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  generateId() {
    return 'peer_' + Math.random().toString(36).substring(2, 10);
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
  }
}

// Run standalone if executed directly
if (require.main === module) {
  const port = process.env.PORT || 8085;
  const server = new SignalingServer(port);
  server.start();

  process.on('SIGINT', () => {
    console.log('\n[Signaling] Shutting down...');
    server.stop();
    process.exit(0);
  });
}

module.exports = SignalingServer;
