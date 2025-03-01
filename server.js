const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from public folder
app.use(express.static('public'));

// In‑memory data
let players = [];
let messages = []; // store last 15 messages
let drawingData = []; // store drawing strokes for new clients
let currentTurnIndex = -1; // index of the player whose turn it is

// Countdown timer variables
let countdownInterval = null;
let countdownValue = 10;

// Start a countdown for the current drawing turn
function startCountdown() {
  countdownValue = 10;
  if (countdownInterval) clearInterval(countdownInterval);
  io.emit('countdown', countdownValue);
  countdownInterval = setInterval(() => {
    countdownValue--;
    if (countdownValue <= 0) {
      clearInterval(countdownInterval);
      // Auto-skip turn: clear canvas and move to next player
      drawingData = [];
      io.emit('clearCanvas');
      if (players.length > 0) {
        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        io.emit('turn', players[currentTurnIndex]);
      }
      startCountdown();
    } else {
      io.emit('countdown', countdownValue);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log('A user connected: ' + socket.id);

  // When a player joins with a nickname
  socket.on('join', (nickname) => {
    console.log('Player joined: ' + nickname);
    players.push({ id: socket.id, nickname });
    socket.nickname = nickname;

    // Send current messages, players, and drawing history to the new client
    socket.emit('init', { messages, players, drawingData });

    // Notify all players with the updated player list
    io.emit('playerList', players);

    // If no turn is active, start with the first player
    if (currentTurnIndex === -1) {
      currentTurnIndex = 0;
      io.emit('turn', players[currentTurnIndex]);
      startCountdown();
    }
  });

  // Relay drawing events to other clients and save for new players
  socket.on('drawing', (data) => {
    drawingData.push(data);
    socket.broadcast.emit('drawing', data);
  });

  // Clear canvas request (by drawing player or auto-skip)
  socket.on('clearCanvas', () => {
    drawingData = [];
    io.emit('clearCanvas');
  });

  // Undo last stroke (simple implementation: remove last drawing data point)
  socket.on('undo', () => {
    if (drawingData.length > 0) {
      drawingData.pop();
      io.emit('undo');
      io.emit('redraw', drawingData);
    }
  });

  // Messaging: add message to list (keeps last 15 only) and broadcast
  socket.on('message', (msg) => {
    const message = { nickname: socket.nickname, text: msg, time: new Date().toISOString() };
    messages.push(message);
    if (messages.length > 15) messages.shift();
    io.emit('message', message);
  });

  // Turn actions: "draw", "skip" or "giveup"
  socket.on('turnAction', (action) => {
    // Ensure only the player whose turn it is can take action
    if (players[currentTurnIndex] && players[currentTurnIndex].id === socket.id) {
      if (action === 'skip' || action === 'giveup') {
        if (countdownInterval) clearInterval(countdownInterval);
        drawingData = [];
        io.emit('clearCanvas');
        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        io.emit('turn', players[currentTurnIndex]);
        startCountdown();
      } else if (action === 'draw') {
        // Confirm drawing: for now we just clear the countdown (can be extended as needed)
        if (countdownInterval) clearInterval(countdownInterval);
      }
    }
  });

  // Handle disconnection: update players and adjust turn if needed
  socket.on('disconnect', () => {
    console.log('User disconnected: ' + socket.id);
    players = players.filter(p => p.id !== socket.id);
    io.emit('playerList', players);
    if (players.length === 0) {
      currentTurnIndex = -1;
      if (countdownInterval) clearInterval(countdownInterval);
    } else {
      if (currentTurnIndex >= players.length) currentTurnIndex = 0;
      io.emit('turn', players[currentTurnIndex]);
      if (countdownInterval) clearInterval(countdownInterval);
      startCountdown();
    }
  });
});

server.listen(PORT, () => {
  console.log('Server is running on port ' + PORT);
});
