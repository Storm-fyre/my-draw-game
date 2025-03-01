const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const objects = require('./objects.json');
const lobbiesConfig = require('./lobbies.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Temporary storage for players who have set a nickname but not yet joined a lobby.
 
// We also maintain a global object "lobbies" to store per–lobby state.
let lobbies = {}; // key: lobbyName, value: { players, playerOrder, chatMessages, currentDrawer, turnTimer, currentObject, guessedCorrectly, currentDrawTimeLeft }

// Helper: Get or create a lobby object.
function getLobby(lobbyName) {
  if (!lobbies[lobbyName]) {
    lobbies[lobbyName] = {
      players: {},          // { socket.id: { nickname, score } }
      playerOrder: [],      // [ socket.id, ... ]
      chatMessages: [],     // last 15 messages
      currentDrawer: null,  // socket.id of current drawer
      turnTimer: null,
      currentObject: null,
      guessedCorrectly: {},
      currentDrawTimeLeft: 0
    };
  }
  return lobbies[lobbyName];
}

// Levenshtein distance and similarity functions
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

// Get n random objects from the list (no duplicates)
function getRandomObjects(n) {
  let shuffled = objects.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// Start a new turn in the given lobby (object selection phase)
function startNextTurn(lobbyName) {
  let lobby = getLobby(lobbyName);
  // Clear the canvas for all players in this lobby
  io.to(lobbyName).emit('clearCanvas');
  // Reset round state
  lobby.currentObject = null;
  lobby.guessedCorrectly = {};
  
  if (lobby.playerOrder.length === 0) {
    lobby.currentDrawer = null;
    return;
  }
  let currentIndex = lobby.playerOrder.indexOf(lobby.currentDrawer);
  if (currentIndex === -1 || currentIndex === lobby.playerOrder.length - 1) {
    lobby.currentDrawer = lobby.playerOrder[0];
  } else {
    lobby.currentDrawer = lobby.playerOrder[currentIndex + 1];
  }
  // Inform players in the lobby of the new turn (object selection phase)
  io.to(lobbyName).emit('turnStarted', { currentDrawer: lobby.currentDrawer, duration: 10 });
  const options = getRandomObjects(3);
  io.to(lobby.currentDrawer).emit('objectSelection', { options, duration: 10 });
  
  let timeLeft = 10;
  lobby.turnTimer = setInterval(() => {
    timeLeft--;
    io.to(lobbyName).emit('turnCountdown', timeLeft);
    if (timeLeft <= 0) {
      clearInterval(lobby.turnTimer);
      lobby.turnTimer = null;
      io.to(lobby.currentDrawer).emit('turnTimeout');
      startNextTurn(lobbyName);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // First, the client sends 'setNickname'
  socket.on('setNickname', (nickname) => {
    socket.nickname = nickname;
    // Send the available lobbies (from lobbiesConfig) to the client.
    socket.emit('lobbiesList', lobbiesConfig);
  });
  
  // Next, the client sends 'joinLobby' with chosen lobby and passcode.
  socket.on('joinLobby', ({ lobbyName, passcode }) => {
    const lobbyConfig = lobbiesConfig.find(l => l.name === lobbyName);
    if (!lobbyConfig) {
      socket.emit('lobbyError', "Lobby not found.");
      return;
    }
    if (lobbyConfig.passcode !== passcode) {
      socket.emit('lobbyError', "Incorrect passcode.");
      return;
    }
    // Join the lobby room.
    socket.join(lobbyName);
    socket.lobbyName = lobbyName;
    let lobby = getLobby(lobbyName);
    // Add player to the lobby players list.
    lobby.players[socket.id] = { nickname: socket.nickname, score: 0 };
    lobby.playerOrder.push(socket.id);
    // Send initial data to this player.
    socket.emit('init', {
      players: Object.values(lobby.players),
      chatMessages: lobby.chatMessages
    });
    // Update all players in this lobby.
    io.to(lobbyName).emit('updatePlayers', Object.values(lobby.players));
    // If no turn is active, start one.
    if (!lobby.currentDrawer) {
      startNextTurn(lobbyName);
    }
  });
  
  // Chat messages (and checking guesses in drawing phase)
  socket.on('chatMessage', (message) => {
    if (!socket.lobbyName) return;
    let lobby = getLobby(socket.lobbyName);
    // If in drawing phase and the sender is not the drawer, check the guess.
    if (lobby.currentObject && socket.id !== lobby.currentDrawer) {
      if (!lobby.guessedCorrectly[socket.id]) {
        const guess = message.trim().toLowerCase();
        const answer = lobby.currentObject.trim().toLowerCase();
        const sim = similarity(guess, answer);
        if (sim >= 60) {
          lobby.guessedCorrectly[socket.id] = true;
          // Calculate points: next multiple of 10 (higher than remaining time) divided by 10.
          const points = Math.ceil((lobby.currentDrawTimeLeft + 1) / 10);
          lobby.players[socket.id].score += points;
          const nick = lobby.players[socket.id].nickname;
          const correctMsg = `${nick} guessed correctly and earned ${points} points!`;
          io.to(socket.lobbyName).emit('chatMessage', { nickname: "SYSTEM", message: correctMsg });
          io.to(socket.lobbyName).emit('updatePlayers', Object.values(lobby.players));
          // Do not broadcast the original guess.
          return;
        }
      }
    }
    // Otherwise, broadcast the chat message.
    const nick = socket.nickname || "Unknown";
    const chatData = { nickname: nick, message };
    lobby.chatMessages.push(chatData);
    if (lobby.chatMessages.length > 15) {
      lobby.chatMessages.shift();
    }
    io.to(socket.lobbyName).emit('chatMessage', chatData);
  });
  
  // Broadcast drawing data only if from the current drawer.
  socket.on('drawing', (data) => {
    if (!socket.lobbyName) return;
    let lobby = getLobby(socket.lobbyName);
    if (socket.id === lobby.currentDrawer) {
      socket.broadcast.to(socket.lobbyName).emit('drawing', data);
    }
  });
  
  socket.on('undo', () => {
    if (!socket.lobbyName) return;
    let lobby = getLobby(socket.lobbyName);
    if (socket.id === lobby.currentDrawer) {
      io.to(socket.lobbyName).emit('undo');
    }
  });
  
  socket.on('clear', () => {
    if (!socket.lobbyName) return;
    let lobby = getLobby(socket.lobbyName);
    if (socket.id === lobby.currentDrawer) {
      io.to(socket.lobbyName).emit('clearCanvas');
    }
  });
  
  socket.on('giveUp', () => {
    if (!socket.lobbyName) return;
    let lobby = getLobby(socket.lobbyName);
    if (socket.id === lobby.currentDrawer) {
      if (lobby.turnTimer) {
        clearInterval(lobby.turnTimer);
        lobby.turnTimer = null;
      }
      io.to(socket.lobbyName).emit('clearCanvas');
      startNextTurn(socket.lobbyName);
    }
  });
  
  // When the current drawer selects an object from the three options.
  socket.on('objectChosen', (objectChosen) => {
    if (!socket.lobbyName) return;
    let lobby = getLobby(socket.lobbyName);
    if (socket.id === lobby.currentDrawer && !lobby.currentObject) {
      if (lobby.turnTimer) {
        clearInterval(lobby.turnTimer);
        lobby.turnTimer = null;
      }
      lobby.currentObject = objectChosen;
      lobby.guessedCorrectly = {};
      lobby.currentDrawTimeLeft = 70;
      io.to(socket.lobbyName).emit('drawPhaseStarted', { currentDrawer: lobby.currentDrawer, duration: 70 });
      let timeLeft = 70;
      lobby.turnTimer = setInterval(() => {
        timeLeft--;
        lobby.currentDrawTimeLeft = timeLeft;
        io.to(socket.lobbyName).emit('drawPhaseCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(lobby.turnTimer);
          lobby.turnTimer = null;
          io.to(lobby.currentDrawer).emit('drawPhaseTimeout');
          startNextTurn(socket.lobbyName);
        }
      }, 1000);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (socket.lobbyName) {
      let lobby = getLobby(socket.lobbyName);
      delete lobby.players[socket.id];
      lobby.playerOrder = lobby.playerOrder.filter(id => id !== socket.id);
      io.to(socket.lobbyName).emit('updatePlayers', Object.values(lobby.players));
      // If the disconnecting player was the current drawer, start next turn.
      if (socket.id === lobby.currentDrawer) {
        startNextTurn(socket.lobbyName);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
