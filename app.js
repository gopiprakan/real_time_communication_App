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
        participants: {}, // { socketId: { userName } }
        socket: null
    };

    // --- UI/Avatar Helpers ---
    function getAvatarURL(seed) {
        // Assign a style based on the seed string to keep it consistent for that user
        const styles = ['avataaars', 'bottts', 'adventurer', 'lorelei', 'personas'];
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        const styleIndex = Math.abs(hash) % styles.length;
        const style = styles[styleIndex];

        return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
    }

    function getInitials(name) {
        if (!name) return '??';
        return name.split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    }

    function saveMeetingToHistory(roomId) {
        if (!roomId) return;

        try {
            const history = JSON.parse(localStorage.getItem('meeting_history') || '[]');
            const now = new Date();

            // Avoid duplicate entries for the same room in the same session, 
            // or just update the timestamp if it's the same room
            const existingIndex = history.findIndex(m => m.id === roomId);

            const newEntry = {
                id: roomId,
                title: `Meeting Session`,
                date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                timestamp: now.getTime()
            };

            if (existingIndex !== -1) {
                // Update existing
                history.splice(existingIndex, 1);
            }

            history.unshift(newEntry);

            // Limit to 10 items
            const limitedHistory = history.slice(0, 10);
            localStorage.setItem('meeting_history', JSON.stringify(limitedHistory));
        } catch (e) {
            console.error('Error saving history:', e);
        }
    }

    function displayMeetingHistory() {
        const list = document.querySelector('.meetings-list');
        if (!list) return;

        try {
            const history = JSON.parse(localStorage.getItem('meeting_history') || '[]');

            if (history.length === 0) {
                list.innerHTML = `
                    <div class="meeting-item no-history">
                        <p>No recent meetings yet.</p>
                    </div>
                `;
                return;
            }

            list.innerHTML = history.map(meeting => `
                <div class="meeting-item">
                    <div class="meeting-info">
                        <div class="meeting-icon">
                            <i data-lucide="calendar"></i>
                        </div>
                        <div class="meeting-details">
                            <h4>${meeting.title}</h4>
                            <span>${meeting.date}, ${meeting.time} • ID: ${meeting.id}</span>
                        </div>
                    </div>
                    <button class="btn btn-ghost" onclick="window.rejoinMeeting('${meeting.id}')">Join Again</button>
                </div>
            `).join('');

            lucide.createIcons();
        } catch (e) {
            console.error('Error displaying history:', e);
        }
    }

    // Expose rejoin function to window for the buttons
    window.rejoinMeeting = (roomId) => {
        meetingIdInput.value = roomId;
        joinBtn.click();
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
            state.participants[socketId] = { userName };
            updateParticipantList();
        });

        state.socket.on('existing-users', async ({ users }) => {
            for (const user of users) {
                state.participants[user.socketId] = { userName: user.userName };
                await createPeerConnection(user.socketId, user.userName, true);
            }
            updateParticipantList();
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
                <img src="${getAvatarURL(userName)}" alt="${userName}">
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
        if (state.participants[socketId]) {
            delete state.participants[socketId];
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
        const micIcon = state.isMuted ? 'mic-off' : 'mic';
        toggleMic.innerHTML = `<i data-lucide="${micIcon}"></i>`;
        toggleMic.className = `control-btn ${state.isMuted ? 'danger' : ''}`;

        const localMicStatus = document.getElementById('local-mic-status');
        if (localMicStatus) {
            localMicStatus.outerHTML = `<i data-lucide="${micIcon}" class="status-icon ${state.isMuted ? 'mic-muted text-danger' : ''}" id="local-mic-status"></i>`;
        }

        // Video
        const videoIcon = state.isVideoOff ? 'video-off' : 'video';
        toggleVideo.innerHTML = `<i data-lucide="${videoIcon}"></i>`;
        toggleVideo.className = `control-btn ${state.isVideoOff ? 'danger' : ''}`;
        localVideoContainer.classList.toggle('no-video', state.isVideoOff);

        // Screen Share
        const screenIcon = state.isSharingScreen ? 'monitor-off' : 'monitor';
        shareScreen.innerHTML = `<i data-lucide="${screenIcon}"></i>`;
        shareScreen.classList.toggle('active', state.isSharingScreen);

        lucide.createIcons();
    }

    function switchView(viewName) {
        Object.keys(views).forEach(key => views[key].classList.add('hidden'));
        views[viewName].classList.remove('hidden');
        state.currentView = viewName;

        if (viewName === 'dashboard') {
            displayMeetingHistory();
        }
    }

    function updateParticipantList() {
        const list = document.getElementById('participant-list');
        if (!list) return;

        list.innerHTML = `
            <div class="participant-item">
                <img src="${getAvatarURL(state.user.name)}" alt="Avatar">
                <div class="participant-info">
                    <span class="name">${state.user.name} (You)</span>
                    <span class="status">Host</span>
                </div>
            </div>
        `;

        // Add other peers
        Object.keys(state.participants).forEach(socketId => {
            const p = state.participants[socketId];
            const div = document.createElement('div');
            div.className = 'participant-item';
            div.innerHTML = `
                <img src="${getAvatarURL(p.userName)}" alt="Avatar">
                <div class="participant-info">
                    <span class="name">${p.userName}</span>
                    <span class="status">Participant</span>
                </div>
                <div class="participant-actions">
                    <i data-lucide="mic" class="status-icon ${state.peers[socketId] && !state.peers[socketId].getReceivers().find(r => r.track && r.track.kind === 'audio' && r.track.enabled) ? 'text-danger' : ''}"></i>
                </div>
            `;
            list.appendChild(div);
        });
        lucide.createIcons();
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

    // Auth Form Handling with Firebase
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailField.value;
        const password = document.getElementById('password').value;
        const name = loginNameField.value;

        const authSubmitBtn = document.getElementById('auth-submit');
        authSubmitBtn.disabled = true;
        authSubmitBtn.querySelector('span').textContent = state.isLoggingIn ? 'Logging in...' : 'Signing up...';

        try {
            const { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } = window.firebaseAuth;
            const { db, doc, setDoc, serverTimestamp } = window.firebaseDb;

            if (state.isLoggingIn) {
                // Sign In
                await signInWithEmailAndPassword(auth, email, password);
                showToast('Signed in successfully');
            } else {
                // Sign Up
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Update Firebase Auth Profile
                await updateProfile(user, { displayName: name });

                // Store User Data in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    uid: user.uid,
                    displayName: name,
                    email: email,
                    createdAt: serverTimestamp(),
                    avatarStyle: ['avataaars', 'bottts', 'adventurer', 'lorelei', 'personas'][Math.floor(Math.random() * 5)]
                });

                showToast('Account created and details stored');
            }
        } catch (error) {
            console.error('Auth error:', error);
            const errorDiv = document.getElementById('auth-error');
            errorDiv.textContent = error.message;
            errorDiv.style.display = 'block';
            authSubmitBtn.disabled = false;
            authSubmitBtn.querySelector('span').textContent = state.isLoggingIn ? 'Log In' : 'Sign Up';
        }
    });

    // Handle Authentication State Changes
    if (window.firebaseAuth) {
        const { auth, onAuthStateChanged } = window.firebaseAuth;
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // User is signed in
                const name = user.displayName || user.email.split('@')[0];
                state.user = { name, email: user.email, uid: user.uid };

                // Update UI for logged-in user
                usernameDisplay.textContent = name;
                const profileAvatar = document.querySelector('.profile-trigger .avatar');
                if (profileAvatar) profileAvatar.src = getAvatarURL(name);

                const welcomeTitle = document.querySelector('.welcome-section h1');
                if (welcomeTitle) welcomeTitle.textContent = `Good morning, ${name.split(' ')[0]}`;

                const localAvatar = document.getElementById('local-avatar');
                if (localAvatar) localAvatar.src = getAvatarURL(name);

                switchView('dashboard');
                if (!state.socket) initSocket();
            } else {
                // User is signed out
                state.user = null;
                switchView('auth');
                if (state.socket) {
                    state.socket.disconnect();
                    state.socket = null;
                }
            }
        });
    }

    // Logout Handling
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const { auth, signOut } = window.firebaseAuth;
                await signOut(auth);
                showToast('Signed out');
            } catch (error) {
                showToast('Error signing out', 'error');
            }
        });
    }

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
        if (confirm('Are you sure you want to end this meeting?')) {
            // Save to history before leaving
            if (state.roomId) {
                saveMeetingToHistory(state.roomId);
            }

            // Cleanup WebRTC
            if (state.localStream) {
                state.localStream.getTracks().forEach(track => track.stop());
                state.localStream = null;
            }
            if (state.screenStream) {
                state.screenStream.getTracks().forEach(track => track.stop());
                state.screenStream = null;
            }

            // Close all peer connections
            Object.keys(state.peers).forEach(id => {
                if (state.peers[id]) {
                    state.peers[id].close();
                }
            });
            state.peers = {};
            state.participants = {};

            // Remove remote videos from UI
            const remoteContainers = videoGrid.querySelectorAll('.video-container:not(.local)');
            remoteContainers.forEach(container => container.remove());

            // Notify server
            if (state.socket) {
                state.socket.emit('leave-room');
            }

            // Reset meeting state
            state.roomId = null;
            state.isSharingScreen = false;
            state.isWhiteboardOpen = false;
            document.getElementById('whiteboard-container').classList.add('hidden');

            // Switch back to dashboard
            switchView('dashboard');

            showToast('Meeting ended and saved to history');
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

    // File Upload Handling
    const fileUpload = document.getElementById('file-upload');
    const filePreviewArea = document.getElementById('file-preview-area');
    if (fileUpload && filePreviewArea) {
        fileUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                filePreviewArea.style.display = 'block';
                filePreviewArea.querySelector('.file-name').textContent = file.name;
                filePreviewArea.querySelector('.progress-bar').style.width = '0%';

                // Simulate upload
                let progress = 0;
                const interval = setInterval(() => {
                    progress += 10;
                    filePreviewArea.querySelector('.progress-bar').style.width = progress + '%';
                    if (progress >= 100) {
                        clearInterval(interval);
                        showToast(`File "${file.name}" ready to share (simulated)`);
                    }
                }, 100);
            }
        });

        const removeBtn = filePreviewArea.querySelector('.remove-file');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                filePreviewArea.style.display = 'none';
                fileUpload.value = '';
            });
        }
    }

    // Whiteboard simple toggle
    toggleWhiteboard.addEventListener('click', () => {
        state.isWhiteboardOpen = !state.isWhiteboardOpen;
        const wbContainer = document.getElementById('whiteboard-container');
        wbContainer.classList.toggle('hidden', !state.isWhiteboardOpen);
        if (state.isWhiteboardOpen) {
            setTimeout(window.resizeWhiteboard, 100);
        }
    });

    // Sidebar Toggles
    function toggleSidePanel(tabName) {
        const sidePanel = document.getElementById('side-panel');
        const isCurrentlyOpen = !sidePanel.classList.contains('hidden');
        const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');

        if (isCurrentlyOpen && activeTab === tabName) {
            sidePanel.classList.add('hidden');
            document.querySelector('.meeting-container').classList.remove('side-panel-open');
        } else {
            sidePanel.classList.remove('hidden');
            document.querySelector('.meeting-container').classList.add('side-panel-open');
            switchTab(tabName);
        }
    }

    function switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('hidden', !content.id.includes(tabName));
        });
    }

    if (toggleChat) toggleChat.addEventListener('click', () => toggleSidePanel('chat'));
    if (toggleParticipantsControl) toggleParticipantsControl.addEventListener('click', () => toggleSidePanel('participants'));

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
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
            if (parent && !parent.classList.contains('hidden')) {
                canvas.width = parent.clientWidth;
                canvas.height = parent.clientHeight - 64; // header height
            }
        }
        window.resizeWhiteboard = resizeCanvas;

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
        });

        canvas.addEventListener('mouseup', () => drawing = false);
        canvas.addEventListener('mouseout', () => drawing = false);

        // Touch Support
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            drawing = true;
            ctx.beginPath();
            ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!drawing) return;
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            ctx.lineWidth = tool === 'eraser' ? 20 : 2;
            ctx.lineCap = 'round';
            ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : '#6366f1';
            ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
            ctx.stroke();
        });

        canvas.addEventListener('touchend', () => drawing = false);

        const penTool = document.getElementById('pen-tool');
        const eraserTool = document.getElementById('eraser-tool');
        const clearBtn = document.getElementById('clear-btn');
        const hideWb = document.getElementById('hide-whiteboard');

        if (penTool) penTool.addEventListener('click', () => {
            tool = 'pen';
            penTool.classList.add('active');
            eraserTool.classList.remove('active');
        });

        if (eraserTool) eraserTool.addEventListener('click', () => {
            tool = 'eraser';
            eraserTool.classList.add('active');
            penTool.classList.remove('active');
        });

        if (clearBtn) clearBtn.addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        });

        if (hideWb) hideWb.addEventListener('click', () => {
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
