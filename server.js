// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Data structures
let players = [];             // { socketId, username, color }
let currentTurnIndex = 0;     // Which player's turn in players[]
let isDrawingPhase = false;   // True if in the 70s drawing window
let decisionTimer = null;
let drawingTimer = null;

let strokes = [];             // Completed strokes: { strokeId, path, color, drawerId }
let nextStrokeId = 1;

// Chat limited to last 15 messages
let chatMessages = []; // { username, text }

// === Utility Functions ===
function generateRandomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 90%, 80%)`;
}

// Clear any active timers
function clearTimers() {
  if (decisionTimer) clearTimeout(decisionTimer);
  if (drawingTimer) clearTimeout(drawingTimer);
  decisionTimer = null;
  drawingTimer = null;
}

// Move to next player's turn
function nextTurn() {
  clearTimers();
  if (players.length === 0) return;

  currentTurnIndex = (currentTurnIndex + 1) % players.length;
  isDrawingPhase = false;
  startDecisionPhase();
}

// Start the 10-second decision phase
function startDecisionPhase() {
  const currentPlayer = players[currentTurnIndex];
  if (!currentPlayer) return;

  io.emit('turnInfo', {
    currentPlayerId: currentPlayer.socketId,
    currentPlayerName: currentPlayer.username,
    isDrawingPhase: false,
    timeLeft: 10
  });

  // If no decision in 10s, skip automatically
  decisionTimer = setTimeout(() => {
    nextTurn();
  }, 10000);
}

// Start the 70-second drawing phase
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

  drawingTimer = setTimeout(() => {
    nextTurn();
  }, 70000);
}

// Broadcast players list
function broadcastPlayersList() {
  io.emit('playersList', players.map(p => ({
    username: p.username,
    color: p.color,
    socketId: p.socketId
  })));
}

// === Socket.IO events ===
io.on('connection', (socket) => {
  console.log('[IO] A user connected:', socket.id);

  // A player joins with a username
  socket.on('joinGame', (username) => {
    if (!username || !username.trim()) return;

    const color = generateRandomColor();
    players.push({ socketId: socket.id, username, color });

    // Update everyone about the new player list
    broadcastPlayersList();

    // Send current strokes & chat to the new player
    socket.emit('initCanvas', strokes);
    socket.emit('initChat', chatMessages);

    // If this is the first player, start
    if (players.length === 1) {
      currentTurnIndex = 0;
      startDecisionPhase();
    }

    console.log(`[JOIN] ${username} (${socket.id}), color: ${color}`);
  });

  // Decision: "draw" or "skip"
  socket.on('drawChoice', (choice) => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer) return;
    if (socket.id !== currentPlayer.socketId) return;

    if (decisionTimer) clearTimeout(decisionTimer);

    if (choice === 'draw') {
      startDrawingPhase();
    } else {
      nextTurn();
    }
  });

  // === Real-time partial drawing ===
  // "partialDrawing" is broadcast to all other clients so they see the stroke as it happens
  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color }) => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    // Broadcast to others
    socket.broadcast.emit('partialDrawing', { fromX, fromY, toX, toY, color });
  });

  // === Finalize stroke on mouseup ===
  // The client sends the complete path, we store it in strokes[] for undo/clear
  socket.on('strokeComplete', (path) => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    const stroke = {
      strokeId: nextStrokeId++,
      path,
      color: currentPlayer.color,
      drawerId: currentPlayer.socketId
    };
    strokes.push(stroke);

    // Notify everyone that a final stroke is completed
    io.emit('strokeComplete', stroke);
  });

  // Undo last stroke by current drawer
  socket.on('undoStroke', () => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    // Find the last stroke by this drawer
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].drawerId === currentPlayer.socketId) {
        const removed = strokes.splice(i, 1)[0];
        io.emit('removeStroke', removed.strokeId);
        break;
      }
    }
  });

  // Clear the canvas
  socket.on('clearCanvas', () => {
    const currentPlayer = players[currentTurnIndex];
    if (!currentPlayer || !isDrawingPhase) return;
    if (socket.id !== currentPlayer.socketId) return;

    strokes = [];
    io.emit('clearCanvas');
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
      // Reset
      clearTimers();
      strokes = [];
      chatMessages = [];
      currentTurnIndex = 0;
    }

    broadcastPlayersList();
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`);
});
