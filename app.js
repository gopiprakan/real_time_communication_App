/**
 * Connect - Real-Time Communication App
 * Production-ready WebRTC Implementation
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    lucide.createIcons();

    // --- State Management ---
    const state = {
        user: null,
        currentView: 'auth',
        isLoggingIn: true,
        isMuted: false, // Default to unmuted now
        isVideoOff: false,
        isSharingScreen: false,
        isWhiteboardOpen: false,
        isChatOpen: false,
        isParticipantsOpen: false,
        roomId: null,
        localStream: null,
        screenStream: null,
        peers: {}, // { socketId: RTCPeerConnection }
        socket: null
    };

    // --- Configuration ---
    const iceServers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            // Production apps should add TURN servers here:
            // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pwd' }
        ]
    };

    // --- DOM Elements ---
    const views = {
        auth: document.getElementById('auth-view'),
        dashboard: document.getElementById('dashboard-view'),
        meeting: document.getElementById('meeting-view')
    };

    // Auth
    const authForm = document.getElementById('auth-form');
    const authSubmit = document.getElementById('auth-submit');
    const nameGroup = document.getElementById('name-group');
    const authSwitchLink = document.getElementById('auth-switch-link');
    const loginNameField = document.getElementById('full-name');
    const emailField = document.getElementById('email');

    // Dashboard
    const startMeetingBtn = document.getElementById('start-meeting-btn');
    const joinBtn = document.getElementById('join-btn');
    const meetingIdInput = document.getElementById('meeting-id');
    const usernameDisplay = document.querySelector('.username');

    // Meeting Controls
    const toggleMic = document.getElementById('toggle-mic');
    const toggleVideo = document.getElementById('toggle-video');
    const shareScreen = document.getElementById('share-screen');
    const toggleWhiteboard = document.getElementById('toggle-whiteboard');
    const leaveMeeting = document.getElementById('leave-meeting');
    const toggleChat = document.getElementById('toggle-chat');
    const toggleParticipantsControl = document.getElementById('toggle-participants');

    // Media Elements
    const localVideo = document.getElementById('local-video');
    const localVideoContainer = document.getElementById('local-video-container');
    const videoGrid = document.getElementById('video-grid');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendChat = document.getElementById('send-chat');

    // --- Socket Initialization ---
    function initSocket() {
        state.socket = io();

        state.socket.on('user-joined', async ({ userId, userName, socketId }) => {
            showToast(`${userName} joined the room`);
            // In our logic, the newcomer sends the offer. 
            // So existing users just wait for the offer.
        });

        state.socket.on('existing-users', async ({ users }) => {
            for (const user of users) {
                await createPeerConnection(user.socketId, user.userName, true);
            }
        });

        state.socket.on('signal', async ({ from, signal, type, userName, fromSocketId }) => {
            if (type === 'offer') {
                await createPeerConnection(fromSocketId, userName, false, signal);
            } else if (type === 'answer') {
                const peer = state.peers[fromSocketId];
                if (peer) {
                    await peer.setRemoteDescription(new RTCSessionDescription(signal));
                }
            } else if (type === 'ice-candidate') {
                const peer = state.peers[fromSocketId];
                if (peer && signal) {
                    try {
                        await peer.addIceCandidate(new RTCIceCandidate(signal));
                    } catch (e) {
                        console.error('Error adding ice candidate', e);
                    }
                }
            }
        });

        state.socket.on('user-left', ({ userId, socketId }) => {
            removePeer(socketId);
        });

        state.socket.on('receive-message', ({ message, userName, time }) => {
            appendMessage(message, 'received', userName, time);
        });
    }

    // --- WebRTC Logic ---
    async function getLocalStream() {
        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            localVideo.srcObject = state.localStream;
            localVideoContainer.classList.remove('no-video');
            return true;
        } catch (error) {
            console.error('Error accessing media devices:', error);
            showToast('Could not access camera/microphone. Please check permissions.', 'error');
            // Try audio only if video fails
            try {
                state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localVideoContainer.classList.add('no-video');
                return true;
            } catch (e) {
                showToast('Audio also failed. Joining as listener only.', 'error');
                state.localStream = new MediaStream(); // Empty stream
                localVideoContainer.classList.add('no-video');
                return true;
            }
        }
    }

    async function createPeerConnection(socketId, remoteUserName, isOffer, remoteSignal = null) {
        const peer = new RTCPeerConnection(iceServers);
        state.peers[socketId] = peer;

        // Add local tracks
        state.localStream.getTracks().forEach(track => {
            peer.addTrack(track, state.localStream);
        });

        // Remote stream handling
        peer.ontrack = (event) => {
            addRemoteVideo(socketId, remoteUserName, event.streams[0]);
        };

        // ICE candidate handling
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                state.socket.emit('signal', {
                    to: socketId,
                    from: state.socket.id,
                    signal: event.candidate,
                    type: 'ice-candidate'
                });
            }
        };

        if (isOffer) {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            state.socket.emit('signal', {
                to: socketId,
                from: state.socket.id,
                signal: offer,
                type: 'offer',
                userName: state.user.name
            });
        } else {
            await peer.setRemoteDescription(new RTCSessionDescription(remoteSignal));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            state.socket.emit('signal', {
                to: socketId,
                from: state.socket.id,
                signal: answer,
                type: 'answer'
            });
        }

        return peer;
    }

    function addRemoteVideo(socketId, userName, stream) {
        if (document.getElementById(`container-${socketId}`)) return;

        const container = document.createElement('div');
        container.className = 'video-container';
        container.id = `container-${socketId}`;

        container.innerHTML = `
            <video id="video-${socketId}" autoplay playsinline></video>
            <div class="video-placeholder">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}" alt="${userName}">
                <p>${userName}</p>
            </div>
            <div class="video-actions">
                <span>${userName}</span>
                <i data-lucide="mic" class="status-icon" id="mic-${socketId}"></i>
            </div>
        `;

        videoGrid.appendChild(container);
        const videoElem = document.getElementById(`video-${socketId}`);
        videoElem.srcObject = stream;

        lucide.createIcons();
        updateParticipantList();
    }

    function removePeer(socketId) {
        if (state.peers[socketId]) {
            state.peers[socketId].close();
            delete state.peers[socketId];
        }
        const container = document.getElementById(`container-${socketId}`);
        if (container) container.remove();
        updateParticipantList();
        showToast('A participant left');
    }

    // --- Screen Sharing ---
    async function toggleScreenShare() {
        if (!state.isSharingScreen) {
            try {
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = state.screenStream.getVideoTracks()[0];

                // Replace video track in all peers
                for (let socketId in state.peers) {
                    const senders = state.peers[socketId].getSenders();
                    const videoSender = senders.find(s => s.track.kind === 'video');
                    if (videoSender) videoSender.replaceTrack(screenTrack);
                }

                // Update local video
                localVideo.srcObject = state.screenStream;
                state.isSharingScreen = true;

                screenTrack.onended = () => stopScreenShare();
                showToast('Screen sharing active');
            } catch (err) {
                console.error('Error sharing screen:', err);
                showToast('Failed to share screen', 'error');
            }
        } else {
            stopScreenShare();
        }
        updateControlUI();
    }

    function stopScreenShare() {
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(t => t.stop());
            const videoTrack = state.localStream.getVideoTracks()[0];

            // Revert tracks in all peers
            for (let socketId in state.peers) {
                const senders = state.peers[socketId].getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) videoSender.replaceTrack(videoTrack);
            }

            localVideo.srcObject = state.localStream;
            state.isSharingScreen = false;
            showToast('Screen sharing stopped');
        }
        updateControlUI();
    }

    // --- UI Helpers ---
    function updateControlUI() {
        // Mic
        toggleMic.innerHTML = `<i data-lucide="${state.isMuted ? 'mic-off' : 'mic'}"></i>`;
        toggleMic.className = `control-btn ${state.isMuted ? 'danger' : ''}`;
        document.getElementById('local-mic-status').setAttribute('data-lucide', state.isMuted ? 'mic-off' : 'mic');
        document.getElementById('local-mic-status').className = `status-icon ${state.isMuted ? 'mic-muted text-danger' : ''}`;

        // Video
        toggleVideo.innerHTML = `<i data-lucide="${state.isVideoOff ? 'video-off' : 'video'}"></i>`;
        toggleVideo.className = `control-btn ${state.isVideoOff ? 'danger' : ''}`;
        localVideoContainer.classList.toggle('no-video', state.isVideoOff);

        // Screen Share
        shareScreen.classList.toggle('active', state.isSharingScreen);
        shareScreen.querySelector('i').setAttribute('data-lucide', state.isSharingScreen ? 'monitor-off' : 'monitor');

        lucide.createIcons();
    }

    function switchView(viewName) {
        Object.keys(views).forEach(key => views[key].classList.add('hidden'));
        views[viewName].classList.remove('hidden');
        state.currentView = viewName;
    }

    function updateParticipantList() {
        const list = document.getElementById('participant-list');
        list.innerHTML = `
            <div class="participant-item">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${state.user.name}" alt="Avatar">
                <div class="participant-info">
                    <span class="name">${state.user.name} (You)</span>
                    <span class="status">Host</span>
                </div>
            </div>
        `;

        // Add other peers
        // Note: For a real app, we should get the usernames via the signaling server
    }

    function appendMessage(text, type, sender, time = null) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${type}`;
        const timestamp = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        bubble.innerHTML = `
            ${type === 'received' ? `<div class="sender">${sender}</div>` : ''}
            <div class="message-content">${text}</div>
            <div class="time">${timestamp}</div>
        `;
        chatMessages.appendChild(bubble);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        if (type === 'error') toast.style.backgroundColor = 'var(--danger)';

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- Event Listeners ---
    authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = emailField.value;
        const name = state.isLoggingIn ? email.split('@')[0] : loginNameField.value;

        state.user = { name, email };
        usernameDisplay.textContent = name;
        switchView('dashboard');
        initSocket();
        showToast(`Welcome, ${name}!`);
    });

    startMeetingBtn.addEventListener('click', async () => {
        state.roomId = 'room-' + Math.random().toString(36).substr(2, 9);
        await joinRoom();
    });

    joinBtn.addEventListener('click', async () => {
        const id = meetingIdInput.value.trim();
        if (id) {
            state.roomId = id;
            await joinRoom();
        } else {
            showToast('Enter a valid meeting ID', 'error');
        }
    });

    async function joinRoom() {
        const success = await getLocalStream();
        if (success) {
            switchView('meeting');
            const display = document.getElementById('meeting-id-display');
            if (display) display.textContent = state.roomId;
            state.socket.emit('join-room', {
                roomId: state.roomId,
                userId: state.socket.id,
                userName: state.user.name
            });
            updateControlUI();
        }
    }

    const copyBtn = document.getElementById('copy-id-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(state.roomId);
            showToast('Room ID copied to clipboard');
        });
    }

    toggleMic.addEventListener('click', () => {
        state.isMuted = !state.isMuted;
        if (state.localStream) {
            state.localStream.getAudioTracks().forEach(track => track.enabled = !state.isMuted);
        }
        updateControlUI();
    });

    toggleVideo.addEventListener('click', () => {
        state.isVideoOff = !state.isVideoOff;
        if (state.localStream) {
            state.localStream.getVideoTracks().forEach(track => track.enabled = !state.isVideoOff);
        }
        updateControlUI();
    });

    shareScreen.addEventListener('click', toggleScreenShare);

    leaveMeeting.addEventListener('click', () => {
        if (confirm('Leave meeting?')) {
            location.reload(); // Simplest way to clean up all WebRTC and socket state
        }
    });

    sendChat.addEventListener('click', () => {
        const msg = chatInput.value.trim();
        if (msg && state.socket) {
            appendMessage(msg, 'sent', 'You');
            state.socket.emit('send-message', {
                roomId: state.roomId,
                message: msg,
                userName: state.user.name
            });
            chatInput.value = '';
        }
    });

    // Whiteboard simple toggle (logic remains similar but UI needs cleaning)
    toggleWhiteboard.addEventListener('click', () => {
        state.isWhiteboardOpen = !state.isWhiteboardOpen;
        document.getElementById('whiteboard-container').classList.toggle('hidden', !state.isWhiteboardOpen);
    });

    // Sidebar Toggles
    toggleChat.addEventListener('click', () => {
        const sidePanel = document.getElementById('side-panel');
        sidePanel.classList.toggle('hidden');
        document.querySelector('.meeting-container').classList.toggle('side-panel-open');
    });

    // Initialize password toggle
    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('password');
    if (togglePassword) {
        togglePassword.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            togglePassword.innerHTML = `<i data-lucide="${type === 'password' ? 'eye' : 'eye-off'}"></i>`;
            lucide.createIcons();
        });
    }

    // Profile Dropdown Toggle
    const profileTrigger = document.getElementById('profile-trigger');
    const profileDropdown = document.getElementById('profile-dropdown');
    if (profileTrigger && profileDropdown) {
        profileTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('active');
        });

        document.addEventListener('click', () => {
            profileDropdown.classList.remove('active');
        });
    }

    // Whiteboard Logic
    const canvas = document.getElementById('whiteboard-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let tool = 'pen';

        function resizeCanvas() {
            const parent = canvas.parentElement;
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight - 64; // header height
        }

        window.addEventListener('resize', resizeCanvas);
        setTimeout(resizeCanvas, 100);

        canvas.addEventListener('mousedown', (e) => {
            drawing = true;
            ctx.beginPath();
            ctx.moveTo(e.offsetX, e.offsetY);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!drawing) return;
            ctx.lineWidth = tool === 'eraser' ? 20 : 2;
            ctx.lineCap = 'round';
            ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : '#6366f1';
            ctx.lineTo(e.offsetX, e.offsetY);
            ctx.stroke();

            // Notify others (optional, but would need more socket setup)
        });

        canvas.addEventListener('mouseup', () => drawing = false);
        canvas.addEventListener('mouseout', () => drawing = false);

        document.getElementById('pen-tool').addEventListener('click', () => {
            tool = 'pen';
            document.getElementById('pen-tool').classList.add('active');
            document.getElementById('eraser-tool').classList.remove('active');
        });

        document.getElementById('eraser-tool').addEventListener('click', () => {
            tool = 'eraser';
            document.getElementById('eraser-tool').classList.add('active');
            document.getElementById('pen-tool').classList.remove('active');
        });

        document.getElementById('clear-btn').addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        });

        document.getElementById('hide-whiteboard').addEventListener('click', () => {
            state.isWhiteboardOpen = false;
            document.getElementById('whiteboard-container').classList.add('hidden');
        });
    }

    // Handle view switching for login/signup
    authSwitchLink.addEventListener('click', (e) => {
        e.preventDefault();
        state.isLoggingIn = !state.isLoggingIn;
        nameGroup.style.display = state.isLoggingIn ? 'none' : 'block';
        authSubmit.querySelector('span').textContent = state.isLoggingIn ? 'Log In' : 'Sign Up';
        document.getElementById('auth-title').textContent = state.isLoggingIn ? 'Welcome Back' : 'Create Account';
    });
});
