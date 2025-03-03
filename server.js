const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const objects = require('./objects.json');       // drawing objects list, now with clusters
const lobbyInfo = require('./lobbies.json');       // available lobbies and passcodes

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/lobbies', (req, res) => {
  res.json(lobbyInfo);
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
    // Fields for the new change game feature
    changeGameVotes: {},
    changeGameVoting: false,
    clusterVotes: {},
    currentCluster: null
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

// Randomly select n objects from the list (without duplicates) using the chosen cluster.
// If a cluster is set then only that cluster’s objects are used; otherwise, default to the first cluster.
function getRandomObjects(n, clusterHeading) {
  let availableObjects = [];
  if (clusterHeading) {
    const cluster = objects.clusters.find(c => c.heading === clusterHeading);
    if (cluster) {
      availableObjects = cluster.objects.slice();
    }
  } else {
    if (objects.clusters && objects.clusters.length > 0) {
      availableObjects = objects.clusters[0].objects.slice();
    }
  }
  for (let i = availableObjects.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableObjects[i], availableObjects[j]] = [availableObjects[j], availableObjects[i]];
  }
  return availableObjects.slice(0, n);
}

const DECISION_DURATION = 10;
const DRAW_DURATION = 70;

// Start a new turn for a given lobby
function startNextTurn(lobbyName) {
  const state = activeLobbies[lobbyName];
  if (!state) return;
  
  if (state.turnTimer) {
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
  // Clear canvas state for the lobby
  io.to(lobbyName).emit('clearCanvas');
  state.canvasStrokes = [];
  state.currentObject = null;
  state.guessedCorrectly = {};
  
  // Reset any change game votes
  state.changeGameVotes = {};
  state.clusterVotes = {};

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

// Start the change game voting phase by sending cluster choices to all players and starting a 10‑second timer.
function startChangeGameVoting(lobbyName) {
  const state = activeLobbies[lobbyName];
  if (!state) return;
  if (state.changeGameVoting) return;
  state.changeGameVoting = true;
  state.clusterVotes = {};
  // Pause the current turn
  if (state.turnTimer) {
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
  const clusterHeadings = objects.clusters.map(cluster => cluster.heading);
  io.to(lobbyName).emit('changeGameVoting', { clusterHeadings, duration: 10 });
  state.changeGameTimer = setTimeout(() => {
      finishChangeGameVoting(lobbyName);
  }, 10000);
}

// Tally votes after the 10‑second period, send vote details and result message,
// then start a 10‑second countdown before resuming play.
function finishChangeGameVoting(lobbyName) {
  const state = activeLobbies[lobbyName];
  if (!state || !state.changeGameVoting) return;
  clearTimeout(state.changeGameTimer);
  state.changeGameVoting = false;
  let voteCounts = {};
  let playerVotes = {};
  for (let socketId in state.clusterVotes) {
      const vote = state.clusterVotes[socketId];
      voteCounts[vote] = (voteCounts[vote] || 0) + 1;
      if (state.players[socketId]) {
        playerVotes[state.players[socketId].nickname] = vote;
      }
  }
  let maxVotes = 0;
  let winners = [];
  for (let cluster in voteCounts) {
      if (voteCounts[cluster] > maxVotes) {
          maxVotes = voteCounts[cluster];
          winners = [cluster];
      } else if (voteCounts[cluster] === maxVotes) {
          winners.push(cluster);
      }
  }
  let resultMessage = "";
  let chosenCluster;
  if (winners.length === 1) {
      chosenCluster = winners[0];
      resultMessage = `${chosenCluster.toUpperCase()} CLUSTER WON THE VOTE`;
  } else {
      resultMessage = "VOTE IS TIED, STATUS QUO CONTINUES";
      chosenCluster = state.currentCluster || (objects.clusters[0] && objects.clusters[0].heading);
  }
  // Emit the vote results including how each player voted
  io.to(lobbyName).emit('changeGameVoteResult', { playerVotes, resultMessage });
  
  // Start a 10-second countdown before resuming play.
  let countdown = 10;
  io.to(lobbyName).emit('changeGameResultCountdown', countdown);
  state.changeGameResultTimer = setInterval(() => {
    countdown--;
    io.to(lobbyName).emit('changeGameResultCountdown', countdown);
    if (countdown <= 0) {
      clearInterval(state.changeGameResultTimer);
      state.changeGameResultTimer = null;
      state.currentCluster = chosenCluster;
      startNextTurn(lobbyName);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // --- Lobby joining ---
  socket.on('joinLobby', (data) => {
    const lobbyEntry = lobbyInfo.find(l => l.name === data.lobbyName);
    if (!lobbyEntry || (lobbyEntry.passcode && lobbyEntry.passcode !== data.passcode)) {
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
    io.to(lobbyName).emit('updatePlayers', state.playerOrder.map(id => {
      let player = state.players[id];
      return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
    }));
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
  });
  
  // --- Object selection ---
  socket.on('objectChosen', (objectChosen) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
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
  
  // --- Chat (and guessing) ---
  socket.on('chatMessage', (message) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    
    // Handle "CHANGE GAME" trigger:
    // If the message is exactly "CHANGE GAME" (case-insensitive) and no other messages have intervened,
    // record the vote. If every player in the lobby has sent it, start the change game voting phase.
    if (!state.changeGameVoting && message.trim().toUpperCase() === "CHANGE GAME") {
      if (!state.changeGameVotes) state.changeGameVotes = {};
      state.changeGameVotes[socket.id] = true;
      if (Object.keys(state.players).length > 0 && Object.keys(state.changeGameVotes).length === Object.keys(state.players).length) {
          startChangeGameVoting(lobbyName);
      }
      return;
    } else if (!state.changeGameVoting && message.trim().toUpperCase() !== "CHANGE GAME") {
      // Any other message resets the change game votes.
      state.changeGameVotes = {};
    }
    
    // Normal guessing/chat logic
    if (state.currentObject && socket.id !== state.currentDrawer) {
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
    const nickname = state.players[socket.id] ? state.players[socket.id].nickname : 'Unknown';
    const chatData = { nickname, message };
    state.chatMessages.push(chatData);
    if (state.chatMessages.length > 15) {
      state.chatMessages.shift();
    }
    io.to(lobbyName).emit('chatMessage', chatData);
  });
  
  // Handle cluster votes from the voting buttons.
  socket.on('clusterVote', (clusterHeading) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    if (!state.changeGameVoting) return;
    if (!state.clusterVotes) state.clusterVotes = {};
    state.clusterVotes[socket.id] = clusterHeading;
  });
  
  // --- Drawing events ---
  socket.on('drawing', (data) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    if (socket.id === state.currentDrawer) {
      socket.to(lobbyName).emit('drawing', data);
    }
  });
  
  socket.on('strokeComplete', (data) => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    state.canvasStrokes.push(data);
    socket.to(lobbyName).emit('strokeComplete', data);
  });
  
  socket.on('undo', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    if (socket.id === state.currentDrawer) {
      io.to(lobbyName).emit('undo');
    }
  });
  
  socket.on('clear', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
    if (socket.id === state.currentDrawer) {
      io.to(lobbyName).emit('clearCanvas');
      state.canvasStrokes = [];
    }
  });
  
  socket.on('giveUp', () => {
    const lobbyName = socket.lobby;
    if (!lobbyName || !activeLobbies[lobbyName]) return;
    const state = activeLobbies[lobbyName];
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
      delete state.players[socket.id];
      state.playerOrder = state.playerOrder.filter(id => id !== socket.id);
      io.to(lobbyName).emit('updatePlayers', state.playerOrder.map(id => {
        let player = state.players[id];
        return { nickname: player.nickname, score: player.score, rank: state.playerOrder.indexOf(id) + 1 };
      }));
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
