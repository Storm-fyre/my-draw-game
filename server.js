const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const objects = require('./objects.json');       // drawing objects clusters
const lobbyInfo = require('./lobbies.json');       // available lobbies and passcodes

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/lobbies', (req, res) => {
  res.json(lobbyInfo);
});

// UPDATED: include "Free Canvas" mode along with clusters
app.get('/clusters', (req, res) => {
  let clusters = Object.keys(objects);
  clusters.push("Free Canvas");
  res.json(clusters);
});

// Global object for active lobby game states (keyed by lobby name)
let activeLobbies = {};

function createLobbyState() {
  return {
    players: {},        // socket.id -> { nickname, score }
    playerOrder: [],    // array of socket ids in join order
    chatMessages: [],
    canvasStrokes: [],  // store completed strokes for new joiners
    currentDrawer: null,
    currentObject: null,
    guessedCorrectly: {},
    turnTimer: null,
    currentDrawTimeLeft: 0,
    // Set the current cluster to the first key in objects (e.g. "superhero")
    currentCluster: Object.keys(objects)[0],
    pendingGameChange: null,
    currentDecisionTimeLeft: undefined
  };
}

// Levenshtein distance (for fuzzy matching)
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

// Randomly select n objects from the current cluster (without duplicates)
function getRandomObjects(n, cluster) {
  let options = objects[cluster] || [];
  let shuffled = options.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

const DECISION_DURATION = 10;
const DRAW_DURATION = 70;

// Start a new turn for a given lobby (only applicable for turn‐based modes)
function startNextTurn(lobbyName) {
  const state = activeLobbies[lobbyName];
  if (!state) return;
  // In Free Canvas mode, no turn-based gameplay is needed.
  if (state.currentCluster === "Free Canvas") {
    return;
  }
  
  if (state.turnTimer) {
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
  // Clear canvas state for the lobby
  io.to(lobbyName).emit('clearCanvas');
  state.canvasStrokes = [];
  state.currentObject = null;
  state.guessedCorrectly = {};
  
  // Rotate turn based on arrival order
  if (state.playerOrder.length === 0) {
    state.currentDrawer = null;
    return;
  }
  if (state.playerOrder.length === 1) {
    state.currentDrawer = state.playerOrder[0];
  } else {
    let currentIndex = state.playerOrder.indexOf(state.currentDrawer);
    if (currentIndex === -1 || currentIndex === state.playerOrder.length - 1) {
      state.currentDrawer = state.playerOrder[0];
    } else {
      state.currentDrawer = state.playerOrder[currentIndex + 1];
    }
  }
  
  // Send only the uppercase name (no rank info)
  let currentDrawerName = state.players[state.currentDrawer].nickname.toUpperCase();
  io.to(lobbyName).emit('turnStarted', { 
    currentDrawer: state.currentDrawer, 
    duration: DECISION_DURATION,
    currentDrawerName: currentDrawerName
  });
  
  // Pick options only from the current cluster
  let options = getRandomObjects(3, state.currentCluster);
  io.to(state.currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
  
  let timeLeft = DECISION_DURATION;
  state.currentDecisionTimeLeft = timeLeft;
  state.turnTimer = setInterval(() => {
    timeLeft--;
    state.currentDecisionTimeLeft = timeLeft;
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
  
  // --- Lobby joining ---
  socket.on('joinLobby', (data) => {
    const lobbyEntry = lobbyInfo.find(lobby => {
      const lobbyName = Object.keys(lobby)[0];
      return lobbyName === data.lobbyName;
    });
    if (!lobbyEntry) {
      socket.emit('lobbyError', { message: 'Invalid lobby or passcode.' });
      return;
    }
    const passcode = lobbyEntry[Object.keys(lobbyEntry)[0]];
    if (passcode && passcode !== data.passcode) {
      socket.emit('lobbyError', { message: 'Invalid lobby or passcode.' });
      return;
    }
    socket.lobby = data.lobbyName;
    socket.join(data.lobbyName);
    if (!activeLobbies[data.lobbyName]) {
      activeLobbies[data.lobbyName] = createLobbyState();
    }
    socket.emit('lobbyJoined', { lobby: data.lobbyName });
  });
  
  // --- After joining a lobby, set nickname ---
  socket.on('setNickname', (nickname) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    state.players[socket.id] = { nickname, score: 0 };
    state.playerOrder.push(socket.id);
    io.to(lobbyName).emit('chatMessage', { nickname: "", message: `${nickname.toUpperCase()} JOINED` });
    
    // If Free Canvas mode, send a simplified init event
    if (state.currentCluster === "Free Canvas") {
      socket.emit('init', {
        players: state.playerOrder.map(id => {
          let player = state.players[id];
          return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
        }),
        chatMessages: state.chatMessages,
        canvasStrokes: state.canvasStrokes,
        freeCanvas: true
      });
    } else {
      socket.emit('init', {
        players: state.playerOrder.map(id => {
          let player = state.players[id];
          return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
        }),
        chatMessages: [],
        canvasStrokes: state.canvasStrokes,
        decisionTimeLeft: (!state.currentObject && state.currentDecisionTimeLeft !== undefined) ? state.currentDecisionTimeLeft : null,
        currentDrawer: state.currentDrawer || null,
        currentDrawerName: state.currentDrawer ? state.players[state.currentDrawer].nickname.toUpperCase() : null
      });
      if (!state.currentDrawer) {
        state.currentDrawer = socket.id;
        let currentDrawerName = state.players[state.currentDrawer].nickname.toUpperCase();
        io.to(lobbyName).emit('turnStarted', { 
          currentDrawer: state.currentDrawer, 
          duration: DECISION_DURATION,
          currentDrawerName: currentDrawerName
        });
        const options = getRandomObjects(3, state.currentCluster);
        io.to(state.currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
        let timeLeft = DECISION_DURATION;
        state.currentDecisionTimeLeft = timeLeft;
        state.turnTimer = setInterval(() => {
          timeLeft--;
          state.currentDecisionTimeLeft = timeLeft;
          io.to(lobbyName).emit('turnCountdown', timeLeft);
          if (timeLeft <= 0) {
            clearInterval(state.turnTimer);
            state.turnTimer = null;
            io.to(state.currentDrawer).emit('turnTimeout');
            startNextTurn(lobbyName);
          }
        }, 1000);
      }
    }
    io.to(lobbyName).emit('updatePlayers', state.playerOrder.map(id => {
      let player = state.players[id];
      return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
    }));
  });
  
  // --- Object selection ---
  socket.on('objectChosen', (objectChosen) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    // In Free Canvas mode, ignore object selection
    if (state.currentCluster === "Free Canvas") return;
    if (socket.id === state.currentDrawer && !state.currentObject) {
      if (state.turnTimer) {
        clearInterval(state.turnTimer);
        state.turnTimer = null;
      }
      state.currentObject = objectChosen;
      state.guessedCorrectly = {};
      state.currentDrawTimeLeft = DRAW_DURATION;
      io.to(lobbyName).emit('objectChosenBroadcast', { object: state.currentObject });
      io.to(lobbyName).emit('drawPhaseStarted', { currentDrawer: state.currentDrawer, duration: DRAW_DURATION });
      let timeLeft = DRAW_DURATION;
      state.turnTimer = setInterval(() => {
        timeLeft--;
        state.currentDrawTimeLeft = timeLeft;
        io.to(lobbyName).emit('drawPhaseCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(state.turnTimer);
          state.turnTimer = null;
          io.to(state.currentDrawer).emit('drawPhaseTimeout');
          startNextTurn(lobbyName);
        }
      }, 1000);
    }
  });
  
  // --- Chat (and guessing / game change cancellation) ---
  socket.on('chatMessage', (message) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    
    // If a pending game change vote exists and the message is "cancel", cancel the vote.
    if (state.pendingGameChange && message.trim().toLowerCase() === "cancel") {
      clearTimeout(state.pendingGameChange.timeout);
      state.pendingGameChange = null;
      io.to(lobbyName).emit('chatMessage', { nickname: "", message: `GAME CHANGE CANCELED` });
      return;
    }
    
    // In turn-based mode, check guesses. In Free Canvas mode, skip guessing.
    if (state.currentCluster !== "Free Canvas" && state.currentObject && socket.id !== state.currentDrawer) {
      if (!state.guessedCorrectly[socket.id]) {
        const guess = message.trim().toLowerCase();
        const answer = state.currentObject.trim().toLowerCase();
        const sim = similarity(guess, answer);
        if (sim >= 60) {
          state.guessedCorrectly[socket.id] = true;
          const points = Math.ceil((state.currentDrawTimeLeft + 1) / 10) * 10;
          state.players[socket.id].score += points;
          const nickname = state.players[socket.id].nickname;
          const correctMsg = `${nickname.toUpperCase()} GOT ${points} POINTS`;
          io.to(lobbyName).emit('chatMessage', { nickname: "", message: correctMsg });
          io.to(lobbyName).emit('updatePlayers', state.playerOrder.map(id => {
            let player = state.players[id];
            return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
          }));
          if (Object.keys(state.guessedCorrectly).length >= (Object.keys(state.players).length - 1)) {
            if (state.turnTimer) {
              clearInterval(state.turnTimer);
              state.turnTimer = null;
            }
            startNextTurn(lobbyName);
          }
          return;
        }
      }
    }
    const nicknameSender = state.players[socket.id] ? state.players[socket.id].nickname : 'Unknown';
    const chatData = { nickname: nicknameSender, message };
    state.chatMessages.push(chatData);
    if (state.chatMessages.length > 15) {
      state.chatMessages.shift();
    }
    io.to(lobbyName).emit('chatMessage', chatData);
  });
  
  // --- New: Change Game Request ---
  socket.on('changeGameRequest', (data) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    const newCluster = data.newCluster;
    if (!newCluster || newCluster === state.currentCluster) {
      return; // Do nothing if same or invalid cluster.
    }
    if (state.pendingGameChange) {
      socket.emit('chatMessage', { nickname: "", message: `A game change is already pending.` });
      return;
    }
    const initiatingPlayer = state.players[socket.id] ? state.players[socket.id].nickname : 'Unknown';
    io.to(lobbyName).emit('chatMessage', { nickname: "", message: `${initiatingPlayer.toUpperCase()} WANTS TO CHANGE GAME TO ${newCluster.toUpperCase()}, PRESS 'CANCEL' WITHIN 10 SEC TO CANCEL ACTION` });
    state.pendingGameChange = {
      newCluster: newCluster,
      initiatedBy: initiatingPlayer,
      timeout: setTimeout(() => {
        if (state.turnTimer) {
          clearInterval(state.turnTimer);
          state.turnTimer = null;
        }
        state.currentObject = null;
        state.guessedCorrectly = {};
        state.canvasStrokes = [];
        io.to(lobbyName).emit('clearCanvas');
        state.currentCluster = newCluster;
        io.to(lobbyName).emit('gameChanged', { newCluster });
        if (newCluster === "Free Canvas") {
          io.to(lobbyName).emit('canvasMessage', { message: `WELCOME TO 'FREE CANVAS' MODE`, duration: 3000 });
        } else {
          io.to(lobbyName).emit('canvasMessage', { message: `WELCOME TO '${newCluster.toUpperCase()}' GAME`, duration: 3000 });
        }
        state.pendingGameChange = null;
        if (newCluster !== "Free Canvas") {
          setTimeout(() => {
            startNextTurn(lobbyName);
          }, 3000);
        }
      }, 10000)
    };
  });
  
  // --- Drawing events ---
  socket.on('drawing', (data) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    // In Free Canvas mode, broadcast drawing from any player
    if (state.currentCluster === "Free Canvas") {
      socket.to(lobbyName).emit('drawing', data);
    } else {
      if (socket.id === state.currentDrawer) {
        socket.to(lobbyName).emit('drawing', data);
      }
    }
  });
  
  socket.on('strokeComplete', (data) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    state.canvasStrokes.push(data);
    // In Free Canvas mode, broadcast stroke complete from any player
    if (state.currentCluster === "Free Canvas") {
      socket.to(lobbyName).emit('strokeComplete', data);
    } else {
      if (socket.id !== state.currentDrawer) {
        socket.to(lobbyName).emit('strokeComplete', data);
      }
    }
  });
  
  socket.on('undo', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    io.to(lobbyName).emit('undo');
  });
  
  socket.on('clear', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    io.to(lobbyName).emit('clearCanvas');
    state.canvasStrokes = [];
  });
  
  socket.on('giveUp', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    // In Free Canvas mode, ignore giveUp
    if (state.currentCluster === "Free Canvas") return;
    if (socket.id === state.currentDrawer) {
      if (state.turnTimer) {
        clearInterval(state.turnTimer);
        state.turnTimer = null;
      }
      io.to(lobbyName).emit('clearCanvas');
      state.canvasStrokes = [];
      startNextTurn(lobbyName);
    }
  });
  
  socket.on('disconnect', () => {
    const lobbyName = socket.lobby;
    if (lobbyName && activeLobbies[lobbyName]) {
      const state = activeLobbies[lobbyName];
      const player = state.players[socket.id];
      if (player) {
        io.to(lobbyName).emit('chatMessage', { nickname: "", message: `${player.nickname.toUpperCase()} LEFT` });
      }
      delete state.players[socket.id];
      state.playerOrder = state.playerOrder.filter(id => id !== socket.id);
      io.to(lobbyName).emit('updatePlayers', state.playerOrder.map(id => {
        let player = state.players[id];
        return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
      }));
      if (socket.id === state.currentDrawer && state.currentCluster !== "Free Canvas") {
        startNextTurn(lobbyName);
      }
      // If all players left, clear canvas strokes
      if (Object.keys(state.players).length === 0) {
        state.canvasStrokes = [];
      }
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
