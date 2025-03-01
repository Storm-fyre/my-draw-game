const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// In-memory storage for players and messages.
let players = [];
let messages = [];

// Socket.io connection handler.
io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // When a client sends their nickname on join.
    socket.on('join', (nickname) => {
        players.push({ id: socket.id, nickname });
        io.emit('playerList', players); // Update all clients with the new player list.
    });

    // Handle incoming chat messages.
    socket.on('chatMessage', (data) => {
        // data format: { nickname, message }
        messages.push(data);
        if (messages.length > 15) {
            messages.shift(); // Keep only the last 15 messages.
        }
        io.emit('chatMessage', data);
    });

    // Handle real-time drawing data.
    socket.on('drawing', (data) => {
        // data includes normalized coordinates, color, and thickness.
        socket.broadcast.emit('drawing', data);
    });

    // On disconnect, remove player from the list.
    socket.on('disconnect', () => {
        players = players.filter(player => player.id !== socket.id);
        io.emit('playerList', players);
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
