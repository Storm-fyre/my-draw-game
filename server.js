// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Data
let players = [];             // { socketId, username, color }
let currentTurnIndex = 0;
let isDrawingPhase = false;
let decisionTimer = null;
let drawingTimer = null;

let strokes = []; // { strokeId, path, color, thickness, drawerId }
let nextStrokeId = 1;

// Chat
let chatMessages = []; // store last 15 messages

// === Utility ===
function generateRandomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 90%, 80%)`;
}
function clearTimers() {
  if (decisionTimer) clearTimeout(decisionTimer);
  if (drawingTimer) clearTimeout(drawingTimer);
  decisionTimer = null;
  drawingTimer = null;
}
function nextTurn() {
  clearTimers();
  if (players.length === 0) return;

  currentTurnIndex = (currentTurnIndex + 1) % players.length;
  isDrawingPhase = false;
  startDecisionPhase();
}
function startDecisionPhase() {
  const currentPlayer = players[currentTurnIndex];
  if (!currentPlayer) return;

  io.emit('turnInfo', {
    currentPlayerId: currentPlayer.socketId,
    currentPlayerName: currentPlayer.username,
    isDrawingPhase: false,
    timeLeft: 10
  });

  decisionTimer = setTimeout(() => {
    nextTurn();
  }, 10000);
}
function startDrawingPhase() {
  const currentPlayer = players[currentTurnIndex];
  if (!currentPlayer) return;

  isDrawingPhase = true;
  io.emit('turnInfo', {
    currentPlayerId: currentPlayer.socketId,
    currentPlayerName: currentPlayer.username,
    isDrawingPhase: true,
    timeLeft: 70
  });

  // 70s timer
  drawingTimer = setTimeout(() => {
    strokes = [];
    io.emit('clearCanvas');
    nextTurn();
  }, 70000);
}
function broadcastPlayersList() {
  io.emit('playersList', players.map(p => ({
    username: p.username,
    color: p.color,
    socketId: p.socketId
  })));
}

// === Socket.IO ===
io.on('connection', (socket) => {
  console.log('[IO] Connected:', socket.id);

  socket.on('joinGame', (username) => {
    if (!username || !username.trim()) return;
    const color = generateRandomColor();
    players.push({ socketId: socket.id, username, color });

    broadcastPlayersList();
    socket.emit('initCanvas', strokes);
    socket.emit('initChat', chatMessages);

    if (players.length === 1) {
      currentTurnIndex = 0;
      startDecisionPhase();
    }

    console.log(`[JOIN] ${username} (${socket.id}) color=${color}`);
  });

  // 10s decision
  socket.on('drawChoice', (choice) => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || socket.id !== currentPlayer.socketId) return;

    if (decisionTimer) clearTimeout(decisionTimer);

    if (choice === 'draw') {
      startDrawingPhase();
    } else {
      nextTurn();
    }
  });

  // Real-time partial strokes
  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color, thickness }) => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    // Broadcast to others
    socket.broadcast.emit('partialDrawing', { fromX, fromY, toX, toY, color, thickness });
  });

  // Final stroke
  socket.on('strokeComplete', ({ path, color, thickness }) => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    const stroke = {
      strokeId: nextStrokeId++,
      path,
      color,
      thickness,
      drawerId: currentPlayer.socketId
    };
    strokes.push(stroke);

    io.emit('strokeComplete', stroke);
  });

  // Undo last stroke
  socket.on('undoStroke', () => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].drawerId === currentPlayer.socketId) {
        const removed = strokes.splice(i, 1)[0];
        io.emit('removeStroke', removed.strokeId);
        break;
      }
    }
  });

  // Clear
  socket.on('clearCanvas', () => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    strokes = [];
    io.emit('clearCanvas');
  });

  // Give Up
  socket.on('giveUp', () => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    strokes = [];
    io.emit('clearCanvas');
    nextTurn();
  });

  // Chat
  socket.on('chatMessage', (text) => {
    const player = players.find(p => p.socketId === socket.id);
    if (!player) return;

    const msg = { username: player.username, text };
    chatMessages.push(msg);
    if (chatMessages.length > 15) chatMessages.shift();
    io.emit('chatMessage', msg);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('[IO] Disconnected:', socket.id);
    const idx = players.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) {
      const wasCurrent = (idx === currentTurnIndex);
      players.splice(idx, 1);

      if (wasCurrent) {
        nextTurn();
      } else if (idx < currentTurnIndex) {
        currentTurnIndex--;
      }
    }

    if (players.length === 0) {
      clearTimers();
      strokes = [];
      chatMessages = [];
      currentTurnIndex = 0;
    }

    broadcastPlayersList();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on http://localhost:${PORT}`);
});
