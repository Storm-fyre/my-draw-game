const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

let players = {}; // { socket.id: { nickname } }
let playerOrder = []; // keeps the order of players
let chatMessages = []; // stores the last 15 messages
const MAX_CHAT_MESSAGES = 15;

let currentDrawer = null;
let turnTimer = null;
const DECISION_DURATION = 10; // seconds for decision phase
const DRAW_DURATION = 70; // seconds for drawing phase

// Helper: start the next player's turn (decision phase)
function startNextTurn() {
  if(turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
  // Clear the canvas for all players
  io.emit('clearCanvas');
  // Choose next drawer
  if(playerOrder.length === 0) {
    currentDrawer = null;
    return;
  }
  let currentIndex = playerOrder.indexOf(currentDrawer);
  if(currentIndex === -1 || currentIndex === playerOrder.length - 1) {
    currentDrawer = playerOrder[0];
  } else {
    currentDrawer = playerOrder[currentIndex + 1];
  }
  // Inform everyone about the new turn decision phase
  io.emit('turnStarted', { currentDrawer, duration: DECISION_DURATION });
  let timeLeft = DECISION_DURATION;
  turnTimer = setInterval(() => {
    timeLeft--;
    io.emit('turnCountdown', timeLeft);
    if(timeLeft <= 0) {
      clearInterval(turnTimer);
      turnTimer = null;
      io.to(currentDrawer).emit('turnTimeout');
      startNextTurn();
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a player sets their nickname
  socket.on('setNickname', (nickname) => {
    players[socket.id] = { nickname };
    playerOrder.push(socket.id);
    // Send initial data to this player
    socket.emit('init', {
      players: Object.values(players).map(p => p.nickname),
      chatMessages
    });
    // Update player list for everyone
    io.emit('updatePlayers', Object.values(players).map(p => p.nickname));
    // If no current drawer, start with this player
    if (!currentDrawer) {
      currentDrawer = socket.id;
      io.emit('turnStarted', { currentDrawer, duration: DECISION_DURATION });
      let timeLeft = DECISION_DURATION;
      turnTimer = setInterval(() => {
        timeLeft--;
        io.emit('turnCountdown', timeLeft);
        if(timeLeft <= 0) {
          clearInterval(turnTimer);
          turnTimer = null;
          io.to(currentDrawer).emit('turnTimeout');
          startNextTurn();
        }
      }, 1000);
    }
  });

  // Handle chat messages
  socket.on('chatMessage', (message) => {
    const nickname = players[socket.id] ? players[socket.id].nickname : 'Unknown';
    const chatData = { nickname, message };
    chatMessages.push(chatData);
    if (chatMessages.length > MAX_CHAT_MESSAGES) {
      chatMessages.shift();
    }
    io.emit('chatMessage', chatData);
  });

  // Broadcast drawing data only if from the current drawer
  socket.on('drawing', (data) => {
    if (socket.id === currentDrawer) {
      socket.broadcast.emit('drawing', data);
    }
  });

  // Undo last stroke
  socket.on('undo', () => {
    if (socket.id === currentDrawer) {
      io.emit('undo');
    }
  });

  // Clear the canvas
  socket.on('clear', () => {
    if (socket.id === currentDrawer) {
      io.emit('clearCanvas');
    }
  });

  // Give up turn (applies to drawing phase as well)
  socket.on('giveUp', () => {
    if (socket.id === currentDrawer) {
      if(turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
      }
      io.emit('clearCanvas');
      startNextTurn();
    }
  });

  // Turn decision (draw or skip)
  socket.on('turnDecision', (decision) => {
    if (socket.id === currentDrawer) {
      if (decision === 'skip') {
        io.emit('clearCanvas');
        startNextTurn();
      } else if (decision === 'draw') {
        // Player chooses to draw: cancel decision countdown and start drawing phase
        if (turnTimer) {
          clearInterval(turnTimer);
          turnTimer = null;
        }
        // Notify all clients that drawing phase has started with 70 seconds
        io.emit('drawPhaseStarted', { currentDrawer, duration: DRAW_DURATION });
        let timeLeft = DRAW_DURATION;
        turnTimer = setInterval(() => {
          timeLeft--;
          io.emit('drawPhaseCountdown', timeLeft);
          if(timeLeft <= 0) {
            clearInterval(turnTimer);
            turnTimer = null;
            io.to(currentDrawer).emit('drawPhaseTimeout');
            startNextTurn();
          }
        }, 1000);
      }
    }
  });

  // When a player disconnects
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    playerOrder = playerOrder.filter(id => id !== socket.id);
    io.emit('updatePlayers', Object.values(players).map(p => p.nickname));
    if (socket.id === currentDrawer) {
      startNextTurn();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
