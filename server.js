const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const objects = require('./objects.json');    // list of drawing objects
const lobbiesConfig = require('./lobbies.json'); // lobby:passcode pairs

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Global lobby state (each lobby has its own game state)
let lobbyState = {};

// Initialize a lobby state if it does not exist
function initLobby(lobbyName) {
  if (!lobbyState[lobbyName]) {
    lobbyState[lobbyName] = {
      players: {},            // { socket.id: { nickname, score } }
      playerOrder: [],        // Array of socket ids in order
      chatMessages: [],       // Last 15 messages
      currentDrawer: null,
      currentObject: null,
      currentDrawTimeLeft: 0,
      guessedCorrectly: {},   // { socket.id: true }
      turnTimer: null
    };
  }
}

const MAX_CHAT_MESSAGES = 15;
const DECISION_DURATION = 10; // seconds for object selection phase
const DRAW_DURATION = 70;     // seconds for drawing phase

// Levenshtein distance and similarity helper functions
function getLevenshteinDistance(a, b) {
  const matrix = [];
  const aLen = a.length;
  const bLen = b.length;
  for (let i = 0; i <= bLen; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLen; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bLen][aLen];
}

function similarity(str1, str2) {
  str1 = str1.toLowerCase().trim();
  str2 = str2.toLowerCase().trim();
  const distance = getLevenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 100;
  return ((1 - distance / maxLen) * 100);
}

// Helper: Get n random objects from the objects list (no duplicates)
function getRandomObjects(n) {
  let shuffled = objects.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// Start a new turn for a given lobby
function startNextTurn(lobbyName) {
  const state = lobbyState[lobbyName];
  if (state.turnTimer) {
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
  // Clear canvas for all players in this lobby
  io.to(lobbyName).emit('clearCanvas');
  // Reset round state
  state.currentObject = null;
  state.guessedCorrectly = {};
  
  // Choose next drawer
  if (state.playerOrder.length === 0) {
    state.currentDrawer = null;
    return;
  }
  let currentIndex = state.playerOrder.indexOf(state.currentDrawer);
  if (currentIndex === -1 || currentIndex === state.playerOrder.length - 1) {
    state.currentDrawer = state.playerOrder[0];
  } else {
    state.currentDrawer = state.playerOrder[currentIndex + 1];
  }
  // Inform lobby of the new turn (object selection phase)
  io.to(lobbyName).emit('turnStarted', { currentDrawer: state.currentDrawer, duration: DECISION_DURATION });
  // Send object options only to the current drawer
  const options = getRandomObjects(3);
  io.to(state.currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
  
  let timeLeft = DECISION_DURATION;
  state.turnTimer = setInterval(() => {
    timeLeft--;
    io.to(lobbyName).emit('turnCountdown', timeLeft);
    if (timeLeft <= 0) {
      clearInterval(state.turnTimer);
      state.turnTimer = null;
      io.to(state.currentDrawer).emit('turnTimeout');
      startNextTurn(lobbyName);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // First, client sends nickname via "setNickname"
  socket.on('setNickname', (nickname) => {
    // Temporarily store the nickname on the socket
    socket.nickname = nickname;
    // Then ask client to choose a lobby (send available lobby names)
    const availableLobbies = Object.keys(lobbiesConfig);
    socket.emit('lobbyList', availableLobbies);
  });

  // Client joins a lobby after selecting one and entering passcode
  socket.on('joinLobby', (data) => {
    const { lobbyName, passcode } = data;
    // Verify that the lobby exists and passcode is correct
    if (!lobbiesConfig[lobbyName] || lobbiesConfig[lobbyName] !== passcode) {
      socket.emit('lobbyJoinError', 'Incorrect lobby or passcode.');
      return;
    }
    // Join the Socket.IO room for that lobby
    socket.join(lobbyName);
    socket.lobby = lobbyName;
    initLobby(lobbyName);
    const state = lobbyState[lobbyName];
    // Add player to lobby state
    state.players[socket.id] = { nickname: socket.nickname, score: 0 };
    state.playerOrder.push(socket.id);
    // Send initial lobby state to the client
    socket.emit('init', {
      players: Object.values(state.players),
      chatMessages: state.chatMessages
    });
    // Update all players in this lobby with the new player list
    io.to(lobbyName).emit('updatePlayers', Object.values(state.players));
    
    // If no turn is active, start a turn with this player as drawer
    if (!state.currentDrawer) {
      state.currentDrawer = socket.id;
      io.to(lobbyName).emit('turnStarted', { currentDrawer: socket.id, duration: DECISION_DURATION });
      const options = getRandomObjects(3);
      io.to(socket.id).emit('objectSelection', { options, duration: DECISION_DURATION });
      let timeLeft = DECISION_DURATION;
      state.turnTimer = setInterval(() => {
        timeLeft--;
        io.to(lobbyName).emit('turnCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(state.turnTimer);
          state.turnTimer = null;
          io.to(socket.id).emit('turnTimeout');
          startNextTurn(lobbyName);
        }
      }, 1000);
    }
  });

  // When the current drawer chooses an object to draw
  socket.on('objectChosen', (objectChosen) => {
    const lobbyName = socket.lobby;
    if (!lobbyName) return;
    const state = lobbyState[lobbyName];
    if (socket.id === state.currentDrawer && !state.currentObject) {
      if (state.turnTimer) {
        clearInterval(state.turnTimer);
        state.turnTimer = null;
      }
      state.currentObject = objectChosen;
      state.guessedCorrectly = {};
      state.currentDrawTimeLeft = DRAW_DURATION;
      io.to(lobbyName).emit('drawPhaseStarted', { currentDrawer: socket.id, duration: DRAW_DURATION });
      let timeLeft = DRAW_DURATION;
      state.turnTimer = setInterval(() => {
        timeLeft--;
        state.currentDrawTimeLeft = timeLeft;
        io.to(lobbyName).emit('drawPhaseCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(state.turnTimer);
          state.turnTimer = null;
          io.to(socket.id).emit('drawPhaseTimeout');
          startNextTurn(lobbyName);
        }
      }, 1000);
    }
  });

  // Handle chat messages and check guesses during drawing phase
  socket.on('chatMessage', (message) => {
    const lobbyName = socket.lobby;
    if (!lobbyName) return;
    const state = lobbyState[lobbyName];
    // If in drawing phase and the sender is not the current drawer
    if (state.currentObject && socket.id !== state.currentDrawer) {
      if (!state.guessedCorrectly[socket.id]) {
        const guess = message.trim().toLowerCase();
        const answer = state.currentObject.trim().toLowerCase();
        const sim = similarity(guess, answer);
        if (sim >= 60) {
          state.guessedCorrectly[socket.id] = true;
          // Calculate score: next multiple of 10 (above the remaining time) divided by 10.
          const points = Math.ceil((state.currentDrawTimeLeft + 1) / 10);
          state.players[socket.id].score += points;
          const nickname = state.players[socket.id].nickname;
          const correctMsg = `${nickname} guessed correctly and earned ${points} points!`;
          io.to(lobbyName).emit('chatMessage', { nickname: "SYSTEM", message: correctMsg });
          // Update players list with new scores
          io.to(lobbyName).emit('updatePlayers', Object.values(state.players));
          return; // do not broadcast the original guess
        }
      }
    }
    // Otherwise, broadcast the chat message normally
    const nick = socket.nickname || 'Unknown';
    const chatData = { nickname: nick, message };
    state.chatMessages.push(chatData);
    if (state.chatMessages.length > MAX_CHAT_MESSAGES) {
      state.chatMessages.shift();
    }
    io.to(lobbyName).emit('chatMessage', chatData);
  });

  // Broadcast drawing data only if from the current drawer
  socket.on('drawing', (data) => {
    const lobbyName = socket.lobby;
    if (!lobbyName) return;
    const state = lobbyState[lobbyName];
    if (socket.id === state.currentDrawer) {
      socket.to(lobbyName).emit('drawing', data);
    }
  });

  // Undo last stroke (only allowed for the current drawer)
  socket.on('undo', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName) return;
    const state = lobbyState[lobbyName];
    if (socket.id === state.currentDrawer) {
      io.to(lobbyName).emit('undo');
    }
  });

  // Clear the canvas (only allowed for the current drawer)
  socket.on('clear', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName) return;
    const state = lobbyState[lobbyName];
    if (socket.id === state.currentDrawer) {
      io.to(lobbyName).emit('clearCanvas');
      // Also clear stored strokes on purpose
      io.to(lobbyName).emit('resetPaths');
    }
  });

  // Give up turn (from selection or drawing phase)
  socket.on('giveUp', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName) return;
    const state = lobbyState[lobbyName];
    if (socket.id === state.currentDrawer) {
      if (state.turnTimer) {
        clearInterval(state.turnTimer);
        state.turnTimer = null;
      }
      io.to(lobbyName).emit('clearCanvas');
      io.to(lobbyName).emit('resetPaths');
      startNextTurn(lobbyName);
    }
  });

  // When a player disconnects, remove them from their lobby state
  socket.on('disconnect', () => {
    const lobbyName = socket.lobby;
    if (lobbyName && lobbyState[lobbyName]) {
      const state = lobbyState[lobbyName];
      delete state.players[socket.id];
      state.playerOrder = state.playerOrder.filter(id => id !== socket.id);
      io.to(lobbyName).emit('updatePlayers', Object.values(state.players));
      // If the disconnected player was the current drawer, start next turn
      if (socket.id === state.currentDrawer) {
        startNextTurn(lobbyName);
      }
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
