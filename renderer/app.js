/**
 * Stealth Screen Share - App Logic
 * WebRTC screen sharing with WebSocket signaling
 */

class StealthScreenShare {
  constructor() {
    // State
    this.ws = null;
    this.peerId = null;
    this.roomCode = null;
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.localStream = null;
    this.isSharing = false;
    this.selectedSourceId = null;
    this.isFullscreen = false;

    // ICE servers (free STUN servers)
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    };

    // DOM elements
    this.elements = {};
    this.cacheElements();
    this.bindEvents();
    this.bindWindowControls();
  }

  // =========================================
  // DOM Setup
  // =========================================

  cacheElements() {
    this.elements = {
      // Panels
      panelHome: document.getElementById('panelHome'),
      panelCreate: document.getElementById('panelCreate'),
      panelJoin: document.getElementById('panelJoin'),
      panelViewer: document.getElementById('panelViewer'),

      // Home
      cardCreate: document.getElementById('cardCreate'),
      cardJoin: document.getElementById('cardJoin'),

      // Create room
      roomCodeDisplay: document.getElementById('roomCodeDisplay'),
      btnCopyCode: document.getElementById('btnCopyCode'),
      createStatus: document.getElementById('createStatus'),
      createStatusText: document.getElementById('createStatusText'),
      createPeerCount: document.getElementById('createPeerCount'),
      btnShareScreen: document.getElementById('btnShareScreen'),
      btnBackCreate: document.getElementById('btnBackCreate'),

      // Join room
      roomCodeInput: document.getElementById('roomCodeInput'),
      btnJoinRoom: document.getElementById('btnJoinRoom'),
      joinStatus: document.getElementById('joinStatus'),
      joinStatusText: document.getElementById('joinStatusText'),
      btnBackJoin: document.getElementById('btnBackJoin'),

      // Viewer
      remoteVideo: document.getElementById('remoteVideo'),
      viewerPlaceholder: document.getElementById('viewerPlaceholder'),
      viewerContainer: document.getElementById('viewerContainer'),
      connectionOverlay: document.getElementById('connectionOverlay'),
      connectionInfo: document.getElementById('connectionInfo'),
      toolbarRoomCode: document.getElementById('toolbarRoomCode'),

      // Toolbar
      btnToolbarShare: document.getElementById('btnToolbarShare'),
      btnStopShare: document.getElementById('btnStopShare'),
      btnFullscreen: document.getElementById('btnFullscreen'),
      btnAlwaysOnTop: document.getElementById('btnAlwaysOnTop'),
      btnDisconnect: document.getElementById('btnDisconnect'),

      // Source picker modal
      sourcePickerModal: document.getElementById('sourcePickerModal'),
      sourceGrid: document.getElementById('sourceGrid'),
      btnCloseModal: document.getElementById('btnCloseModal'),
      btnCancelSource: document.getElementById('btnCancelSource'),
      btnSelectSource: document.getElementById('btnSelectSource'),

      // Toast
      toastContainer: document.getElementById('toastContainer'),

      // Window controls
      btnMinimize: document.getElementById('btnMinimize'),
      btnMaximize: document.getElementById('btnMaximize'),
      btnClose: document.getElementById('btnClose'),

      // Server input
      serverAddressInput: document.getElementById('serverAddressInput'),
    };
  }

  bindEvents() {
    // Home panel
    this.elements.cardCreate.addEventListener('click', () => this.onCreateRoom());
    this.elements.cardJoin.addEventListener('click', () => this.showPanel('panelJoin'));

    // Create panel
    this.elements.btnCopyCode.addEventListener('click', () => this.copyRoomCode());
    this.elements.btnShareScreen.addEventListener('click', () => this.openSourcePicker());
    this.elements.btnBackCreate.addEventListener('click', () => this.goHome());

    // Join panel
    this.elements.btnJoinRoom.addEventListener('click', () => this.onJoinRoom());
    this.elements.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onJoinRoom();
    });
    this.elements.btnBackJoin.addEventListener('click', () => this.goHome());

    // Toolbar
    this.elements.btnToolbarShare.addEventListener('click', () => this.openSourcePicker());
    this.elements.btnStopShare.addEventListener('click', () => this.stopSharing());
    this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    this.elements.btnAlwaysOnTop.addEventListener('click', () => this.toggleAlwaysOnTop());
    this.elements.btnDisconnect.addEventListener('click', () => this.disconnect());

    // Source picker modal
    this.elements.btnCloseModal.addEventListener('click', () => this.closeSourcePicker());
    this.elements.btnCancelSource.addEventListener('click', () => this.closeSourcePicker());
    this.elements.btnSelectSource.addEventListener('click', () => this.shareSelectedSource());

    // Close modal on overlay click
    this.elements.sourcePickerModal.addEventListener('click', (e) => {
      if (e.target === this.elements.sourcePickerModal) this.closeSourcePicker();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.elements.sourcePickerModal.classList.contains('active')) {
          this.closeSourcePicker();
        } else if (this.isFullscreen) {
          this.toggleFullscreen();
        }
      }
    });
  }

  bindWindowControls() {
    if (!window.electronAPI) return;

    this.elements.btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
    this.elements.btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
    this.elements.btnClose.addEventListener('click', () => window.electronAPI.close());

    window.electronAPI.onAlwaysOnTopChanged((value) => {
      this.elements.btnAlwaysOnTop.classList.toggle('active', value);
    });
  }

  // =========================================
  // Panel Navigation
  // =========================================

  showPanel(panelId) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.add('active');
      // Re-trigger animation
      panel.style.animation = 'none';
      panel.offsetHeight; // reflow
      panel.style.animation = '';
    }
  }

  goHome() {
    this.disconnect();
    this.showPanel('panelHome');
  }

  // =========================================
  // WebSocket Connection
  // =========================================

  connectWebSocket() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const serverAddress = this.elements.serverAddressInput ? this.elements.serverAddressInput.value.trim() : 'localhost:8085';
      const wsUrl = `ws://${serverAddress}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected to signaling server');
        resolve();
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected from signaling server');
        this.ws = null;
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        this.showToast('Failed to connect to server', 'error');
        reject(err);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleSignalingMessage(message);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };
    });
  }

  sendSignaling(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  handleSignalingMessage(message) {
    console.log('[WS] Received:', message.type, message);

    switch (message.type) {
      case 'welcome':
        this.peerId = message.peerId;
        console.log('[WS] Assigned peer ID:', this.peerId);
        break;

      case 'room-created':
        this.roomCode = message.roomCode;
        this.elements.roomCodeDisplay.textContent = message.roomCode;
        this.updateCreateStatus('waiting', 'Waiting for others to join...');
        break;

      case 'room-joined':
        this.roomCode = message.roomCode;
        this.updateJoinStatus('connected', `Connected to room ${message.roomCode}`);
        this.showViewerPanel();
        this.showToast(`Joined room ${message.roomCode}`, 'success');
        break;

      case 'peer-joined':
        this.updateCreateStatus('connected', `${message.peerCount} peers in room`);
        this.elements.createPeerCount.textContent = `${message.peerCount} people in this room`;
        this.showToast('Someone joined the room!', 'info');

        // If we're sharing, create an offer for the new peer
        if (this.isSharing && this.localStream) {
          this.createPeerConnection(message.peerId, true);
        }
        break;

      case 'peer-left':
        this.showToast('A peer left the room', 'info');
        this.closePeerConnection(message.fromPeerId);
        if (message.peerCount !== undefined) {
          this.elements.createPeerCount.textContent = `${message.peerCount} people in this room`;
        }
        break;

      case 'offer':
        this.handleOffer(message);
        break;

      case 'answer':
        this.handleAnswer(message);
        break;

      case 'ice-candidate':
        this.handleIceCandidate(message);
        break;

      case 'screen-share-started':
        this.showToast('Peer started sharing their screen', 'info');
        break;

      case 'screen-share-stopped':
        this.showToast('Peer stopped sharing their screen', 'info');
        this.elements.remoteVideo.srcObject = null;
        this.elements.viewerPlaceholder.style.display = 'flex';
        this.elements.remoteVideo.style.display = 'none';
        break;

      case 'error':
        this.showToast(message.message, 'error');
        if (message.message === 'Room not found') {
          this.updateJoinStatus('error', 'Room not found');
        }
        break;
    }
  }

  // =========================================
  // Room Management
  // =========================================

  async onCreateRoom() {
    this.showPanel('panelCreate');
    this.updateCreateStatus('waiting', 'Connecting to server...');

    try {
      await this.connectWebSocket();
      this.sendSignaling({ type: 'create-room' });
    } catch (err) {
      this.updateCreateStatus('error', 'Failed to connect to server');
    }
  }

  async onJoinRoom() {
    const code = this.elements.roomCodeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      this.showToast('Please enter a valid 6-character room code', 'error');
      return;
    }

    this.elements.joinStatus.style.display = 'flex';
    this.updateJoinStatus('waiting', 'Connecting...');

    try {
      await this.connectWebSocket();
      this.sendSignaling({ type: 'join-room', roomCode: code });
    } catch (err) {
      this.updateJoinStatus('error', 'Failed to connect to server');
    }
  }

  showViewerPanel() {
    this.showPanel('panelViewer');
    this.elements.toolbarRoomCode.textContent = this.roomCode || '------';
    this.elements.viewerPlaceholder.style.display = 'flex';
    this.elements.remoteVideo.style.display = 'none';
  }

  // =========================================
  // WebRTC - Peer Connection
  // =========================================

  createPeerConnection(remotePeerId, isInitiator) {
    console.log(`[RTC] Creating connection for peer: ${remotePeerId}, initiator: ${isInitiator}`);

    // Close existing connection if any
    this.closePeerConnection(remotePeerId);

    const pc = new RTCPeerConnection(this.iceServers);
    this.peerConnections.set(remotePeerId, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetPeerId: remotePeerId
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[RTC] Connection state (${remotePeerId}):`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        this.elements.connectionInfo.textContent = 'Connected - P2P';
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.showToast('Peer connection lost', 'error');
        this.closePeerConnection(remotePeerId);
      }
    };

    // Handle incoming tracks (remote stream)
    pc.ontrack = (event) => {
      console.log('[RTC] Received remote track:', event.track.kind);
      this.elements.remoteVideo.srcObject = event.streams[0];
      this.elements.remoteVideo.style.display = 'block';
      this.elements.viewerPlaceholder.style.display = 'none';
    };

    // Add local stream tracks if we're sharing
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Create offer if we're the initiator
    if (isInitiator) {
      this.createAndSendOffer(pc, remotePeerId);
    }

    return pc;
  }

  async createAndSendOffer(pc, remotePeerId) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignaling({
        type: 'offer',
        sdp: pc.localDescription,
        targetPeerId: remotePeerId
      });

      console.log(`[RTC] Sent offer to ${remotePeerId}`);
    } catch (err) {
      console.error('[RTC] Failed to create offer:', err);
    }
  }

  async handleOffer(message) {
    console.log(`[RTC] Received offer from ${message.fromPeerId}`);

    const pc = this.createPeerConnection(message.fromPeerId, false);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendSignaling({
        type: 'answer',
        sdp: pc.localDescription,
        targetPeerId: message.fromPeerId
      });

      console.log(`[RTC] Sent answer to ${message.fromPeerId}`);

      // Switch to viewer panel if not already there
      if (!document.getElementById('panelViewer').classList.contains('active')) {
        this.showViewerPanel();
      }
    } catch (err) {
      console.error('[RTC] Failed to handle offer:', err);
    }
  }

  async handleAnswer(message) {
    console.log(`[RTC] Received answer from ${message.fromPeerId}`);

    const pc = this.peerConnections.get(message.fromPeerId);
    if (!pc) {
      console.error(`[RTC] No connection found for ${message.fromPeerId}`);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
    } catch (err) {
      console.error('[RTC] Failed to set remote description:', err);
    }
  }

  async handleIceCandidate(message) {
    const pc = this.peerConnections.get(message.fromPeerId);
    if (!pc) {
      console.warn(`[RTC] No connection for ICE candidate from ${message.fromPeerId}`);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    } catch (err) {
      console.error('[RTC] Failed to add ICE candidate:', err);
    }
  }

  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
      console.log(`[RTC] Closed connection for ${peerId}`);
    }
  }

  // =========================================
  // Screen Sharing
  // =========================================

  async openSourcePicker() {
    if (!window.electronAPI) {
      // Fallback: use browser getDisplayMedia directly
      this.startSharingDirect();
      return;
    }

    try {
      const sources = await window.electronAPI.getSources();

      this.elements.sourceGrid.innerHTML = '';
      this.selectedSourceId = null;
      this.elements.btnSelectSource.disabled = true;

      sources.forEach(source => {
        const item = document.createElement('div');
        item.className = 'source-item';
        item.dataset.sourceId = source.id;

        item.innerHTML = `
          <img class="source-thumbnail" src="${source.thumbnail}" alt="${source.name}">
          <div class="source-name" title="${source.name}">${source.name}</div>
        `;

        item.addEventListener('click', () => {
          document.querySelectorAll('.source-item').forEach(s => s.classList.remove('selected'));
          item.classList.add('selected');
          this.selectedSourceId = source.id;
          this.elements.btnSelectSource.disabled = false;
        });

        this.elements.sourceGrid.appendChild(item);
      });

      this.elements.sourcePickerModal.classList.add('active');
    } catch (err) {
      console.error('[Share] Failed to get sources:', err);
      this.showToast('Failed to get screen sources', 'error');
    }
  }

  closeSourcePicker() {
    this.elements.sourcePickerModal.classList.remove('active');
    this.selectedSourceId = null;
  }

  async shareSelectedSource() {
    if (!this.selectedSourceId) return;

    this.closeSourcePicker();

    try {
      // FIX FOR CHROMIUM CRASH: 
      // Chromium crashes if it tries to capture a screen while the app's own window has setContentProtection(true).
      // We temporarily disable stealth mode while starting the capture.
      if (window.electronAPI) {
        window.electronAPI.toggleContentProtection(false);
        // Wait a tiny bit for Windows to remove the WDA_EXCLUDEFROMCAPTURE flag
        await new Promise(r => setTimeout(r, 150));
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: this.selectedSourceId
          }
        }
      });

      this.startSharingStream(stream);
    } catch (err) {
      // If it failed, re-enable stealth mode
      if (window.electronAPI) {
        window.electronAPI.toggleContentProtection(true);
      }
      console.error('[Share] Failed to capture source:', err);
      this.showToast(`Failed to start screen sharing: ${err.message}`, 'error');
    }
  }

  async startSharingDirect() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      this.startSharingStream(stream);
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('[Share] Failed to start sharing:', err);
        this.showToast(`Failed to start screen sharing: ${err.message}`, 'error');
      }
    }
  }

  startSharingStream(stream) {
    this.localStream = stream;
    this.isSharing = true;

    // Listen for stream end (user stops sharing via browser UI)
    stream.getVideoTracks()[0].onended = () => {
      this.stopSharing();
    };

    // Update UI
    this.elements.btnToolbarShare.style.display = 'none';
    this.elements.btnStopShare.style.display = 'flex';
    this.elements.btnStopShare.classList.add('sharing');
    this.elements.btnShareScreen.textContent = 'Sharing...';
    this.elements.btnShareScreen.disabled = true;

    // Notify peers and create connections
    this.sendSignaling({ type: 'screen-share-started' });

    // Add tracks to all existing peer connections, or create new ones
    // For simplicity, broadcast offer to all peers in room
    this.sendSignaling({ type: 'offer-request' });

    // If we have existing peer connections, add tracks to them
    // Otherwise, they'll be added when new peers join and trigger offers
    this.peerConnections.forEach((pc, peerId) => {
      // Replace or add tracks
      const senders = pc.getSenders();
      const videoTrack = stream.getVideoTracks()[0];

      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, stream);
        // Renegotiate
        this.createAndSendOffer(pc, peerId);
      }
    });

    // If no existing peers, the tracks will be added when peers join

    // If we're on the create panel, switch to viewer
    if (document.getElementById('panelCreate').classList.contains('active')) {
      this.showViewerPanel();
    }

    this.showToast('Screen sharing started', 'success');
  }

  stopSharing() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.isSharing = false;

    // Re-enable stealth mode now that we are done sharing
    if (window.electronAPI) {
      window.electronAPI.toggleContentProtection(true);
    }

    // Update UI
    this.elements.btnToolbarShare.style.display = 'flex';
    this.elements.btnStopShare.style.display = 'none';
    this.elements.btnStopShare.classList.remove('sharing');
    this.elements.btnShareScreen.textContent = 'Share Screen';
    this.elements.btnShareScreen.disabled = false;

    // Notify peers
    this.sendSignaling({ type: 'screen-share-stopped' });

    this.showToast('Screen sharing stopped', 'info');
  }

  // =========================================
  // UI Helpers
  // =========================================

  updateCreateStatus(type, text) {
    this.elements.createStatus.className = `status-indicator ${type}`;
    this.elements.createStatusText.textContent = text;
  }

  updateJoinStatus(type, text) {
    this.elements.joinStatus.style.display = 'flex';
    this.elements.joinStatus.className = `status-indicator ${type}`;
    this.elements.joinStatusText.textContent = text;
  }

  async copyRoomCode() {
    if (!this.roomCode) return;
    try {
      await navigator.clipboard.writeText(this.roomCode);
      this.showToast('Room code copied to clipboard!', 'success');
    } catch {
      this.showToast('Failed to copy code', 'error');
    }
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    this.elements.panelViewer.classList.toggle('fullscreen', this.isFullscreen);
    this.elements.btnFullscreen.classList.toggle('active', this.isFullscreen);
  }

  async toggleAlwaysOnTop() {
    if (window.electronAPI) {
      window.electronAPI.toggleAlwaysOnTop();
    }
  }

  disconnect() {
    // Stop sharing
    if (this.isSharing) {
      this.stopSharing();
    }

    // Close all peer connections
    this.peerConnections.forEach((pc, peerId) => {
      pc.close();
    });
    this.peerConnections.clear();

    // Leave room
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignaling({ type: 'leave-room' });
      this.ws.close();
    }

    this.ws = null;
    this.peerId = null;
    this.roomCode = null;

    // Reset video
    this.elements.remoteVideo.srcObject = null;
    this.elements.viewerPlaceholder.style.display = 'flex';
    this.elements.remoteVideo.style.display = 'none';

    // Reset UI
    this.elements.roomCodeDisplay.textContent = '------';
    this.elements.roomCodeInput.value = '';
    this.elements.createPeerCount.textContent = '';
    this.elements.joinStatus.style.display = 'none';
    this.elements.btnShareScreen.disabled = false;
    this.elements.btnShareScreen.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M12 10v4M10 12h4"/>
      </svg>
      Share Screen
    `;
    this.elements.btnToolbarShare.style.display = 'flex';
    this.elements.btnStopShare.style.display = 'none';
  }

  // =========================================
  // Toast Notifications
  // =========================================

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;

    this.elements.toastContainer.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// =========================================
// Initialize
// =========================================

document.addEventListener('DOMContentLoaded', () => {
  window.app = new StealthScreenShare();
});
