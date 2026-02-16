const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3456;

app.use(express.static(path.join(__dirname)));

// Store room information
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, userId, userName }) => {
        // Get existing users in room
        const clients = io.sockets.adapter.rooms.get(roomId);
        const existingUsers = [];
        if (clients) {
            for (const clientId of clients) {
                const clientSocket = io.sockets.sockets.get(clientId);
                if (clientSocket && clientSocket.id !== socket.id) {
                    existingUsers.push({
                        socketId: clientSocket.id,
                        userName: clientSocket.userName || 'User'
                    });
                }
            }
        }

        socket.userName = userName; // Store on socket for later
        socket.roomId = roomId; // Track current room
        socket.join(roomId);
        console.log(`User ${userId} (${userName}) joined room: ${roomId}`);

        // Tell the newcomer about existing users
        socket.emit('existing-users', { users: existingUsers });

        // Notify others in the room
        socket.to(roomId).emit('user-joined', { userId, userName, socketId: socket.id });
    });

    socket.on('leave-room', () => {
        if (socket.roomId) {
            const roomId = socket.roomId;
            socket.to(roomId).emit('user-left', { userId: socket.id, socketId: socket.id });
            socket.leave(roomId);
            console.log(`User ${socket.id} left room: ${roomId}`);
            socket.roomId = null;
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-left', { userId: socket.id, socketId: socket.id });
        }
    });

    // WebRTC Signaling
    socket.on('signal', ({ to, from, signal, type, userName }) => {
        // 'to' is the socketId of the target recipient
        io.to(to).emit('signal', { from, signal, type, userName, fromSocketId: socket.id });
    });

    // Chat messaging
    socket.on('send-message', ({ roomId, message, userName }) => {
        socket.to(roomId).emit('receive-message', { message, userName, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
