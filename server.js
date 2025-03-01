// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const lobbyData = require('./lobbies');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from "public"
app.use(express.static(path.join(__dirname, 'public')));

/*
  We'll store a `rooms` object keyed by the lobby name.
  Each room has:
    - passcode (from lobbies.js)
    - players: []  (each: { socketId, username })
    - strokes: []
    - chatMessages: []
    - currentTurnIndex: 0
    - isDrawingPhase: bool
    - decisionTimer, drawingTimer
*/
const rooms = {};

// Initialize each lobby from lobbies.js
lobbyData.forEach((l) => {
  rooms[l.name] = {
    passcode: l.passcode,
    players: [],
    strokes: [],
    chatMessages: [],
    currentTurnIndex: 0,
    isDrawingPhase: false,
    decisionTimer: null,
    drawingTimer: null
  };
});

/** Helper Functions **/
function clearTimers(roomObj) {
  if (roomObj.decisionTimer) clearTimeout(roomObj.decisionTimer);
  if (roomObj.drawingTimer) clearTimeout(roomObj.drawingTimer);
  roomObj.decisionTimer = null;
  roomObj.drawingTimer = null;
}

function nextTurn(lobbyName) {
  const room = rooms[lobbyName];
  if (!room) return;
  clearTimers(room);

  if (room.players.length === 0) return;

  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  room.isDrawingPhase = false;
  startDecisionPhase(lobbyName);
}

function startDecisionPhase(lobbyName) {
  const room = rooms[lobbyName];
  if (!room) return;

  const currentPlayer = room.players[room.currentTurnIndex];
  if (!currentPlayer) return;

  io.to(lobbyName).emit('turnInfo', {
    currentPlayerId: currentPlayer.socketId,
    currentPlayerName: currentPlayer.username,
    isDrawingPhase: false,
    timeLeft: 10
  });

  // 10s to choose
  room.decisionTimer = setTimeout(() => {
    nextTurn(lobbyName);
  }, 10000);
}

function startDrawingPhase(lobbyName) {
  const room = rooms[lobbyName];
  if (!room) return;

  const currentPlayer = room.players[room.currentTurnIndex];
  if (!currentPlayer) return;

  room.isDrawingPhase = true;

  io.to(lobbyName).emit('turnInfo', {
    currentPlayerId: currentPlayer.socketId,
    currentPlayerName: currentPlayer.username,
    isDrawingPhase: true,
    timeLeft: 70
  });

  // 70s timer
  room.drawingTimer = setTimeout(() => {
    // time up -> clear canvas
    room.strokes = [];
    io.to(lobbyName).emit('clearCanvas');
    nextTurn(lobbyName);
  }, 70000);
}

function broadcastPlayersList(lobbyName) {
  const room = rooms[lobbyName];
  if (!room) return;

  // We could also store a color if we want, but for now just username
  io.to(lobbyName).emit('playersList', room.players.map(p => ({
    username: p.username,
    // color: p.color => optional if you want each user color
    socketId: p.socketId
  })));
}

/** Socket.IO **/
io.on('connection', (socket) => {
  console.log('[IO] Connected:', socket.id);

  /*
    1) After user enters nickname, they request "joinLobby" with:
       { lobbyName, passcode, username }
  */
  socket.on('joinLobby', ({ lobbyName, passcode, username }) => {
    const room = rooms[lobbyName];
    if (!room) {
      socket.emit('lobbyError', 'Lobby not found.');
      return;
    }
    if (passcode !== room.passcode) {
      socket.emit('lobbyError', 'Incorrect passcode.');
      return;
    }

    // If passcode is correct, join socket.io "room" for that lobby
    socket.join(lobbyName);

    // Add player data to that room
    room.players.push({
      socketId: socket.id,
      username
    });

    // Send them the current strokes & chat
    socket.emit('initCanvas', room.strokes);
    socket.emit('initChat', room.chatMessages);

    // Broadcast updated players list
    broadcastPlayersList(lobbyName);

    // If this is the only player, start the decision phase
    if (room.players.length === 1) {
      room.currentTurnIndex = 0;
      startDecisionPhase(lobbyName);
    }

    // Store the chosen lobby name on the socket so we know where they belong
    socket.data.lobbyName = lobbyName;

    console.log(`[JOIN] user=${username} joined lobby=${lobbyName}`);
  });

  // Decision: draw or skip
  socket.on('drawChoice', (choice) => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;

    const room = rooms[lobbyName];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;

    if (room.decisionTimer) clearTimeout(room.decisionTimer);

    if (choice === 'draw') {
      startDrawingPhase(lobbyName);
    } else {
      nextTurn(lobbyName);
    }
  });

  // Real-time partial drawing
  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color, thickness }) => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;
    if (!room.isDrawingPhase) return;

    // Broadcast to others in the same lobby
    socket.to(lobbyName).emit('partialDrawing', {
      fromX, fromY, toX, toY, color, thickness
    });
  });

  // Final stroke
  socket.on('strokeComplete', ({ path, color, thickness }) => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;
    if (!room.isDrawingPhase) return;

    const stroke = {
      strokeId: Date.now() + Math.random(), // or a global ID
      path,
      color,
      thickness,
      drawerId: socket.id
    };
    room.strokes.push(stroke);

    io.to(lobbyName).emit('strokeComplete', stroke);
  });

  // Undo last stroke
  socket.on('undoStroke', () => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;
    if (!room.isDrawingPhase) return;

    for (let i = room.strokes.length - 1; i >= 0; i--) {
      if (room.strokes[i].drawerId === socket.id) {
        const removed = room.strokes.splice(i, 1)[0];
        io.to(lobbyName).emit('removeStroke', removed.strokeId);
        break;
      }
    }
  });

  // Clear
  socket.on('clearCanvas', () => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;
    if (!room.isDrawingPhase) return;

    room.strokes = [];
    io.to(lobbyName).emit('clearCanvas');
  });

  // Give Up
  socket.on('giveUp', () => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (!currentPlayer || currentPlayer.socketId !== socket.id) return;
    if (!room.isDrawingPhase) return;

    room.strokes = [];
    io.to(lobbyName).emit('clearCanvas');
    nextTurn(lobbyName);
  });

  // Chat
  socket.on('chatMessage', (text) => {
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const msg = { username: player.username, text };
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 15) {
      room.chatMessages.shift();
    }
    io.to(lobbyName).emit('chatMessage', msg);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('[IO] Disconnected:', socket.id);
    const lobbyName = socket.data.lobbyName;
    if (!lobbyName) return;
    const room = rooms[lobbyName];
    if (!room) return;

    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) {
      const wasCurrent = (idx === room.currentTurnIndex);
      room.players.splice(idx, 1);

      if (wasCurrent) {
        nextTurn(lobbyName);
      } else if (idx < room.currentTurnIndex) {
        room.currentTurnIndex--;
      }
    }

    if (room.players.length === 0) {
      // reset room
      clearTimers(room);
      room.strokes = [];
      room.chatMessages = [];
      room.currentTurnIndex = 0;
      room.isDrawingPhase = false;
    }

    broadcastPlayersList(lobbyName);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on http://localhost:${PORT}`);
});
