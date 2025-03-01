const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const objects = require('./objects.json');
const lobbiesData = require('./lobbies.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Global games object to maintain per‑lobby game state.
const games = {}; 
/*
Each game state has the structure:
{
  players: { [socket.id]: { nickname, score } },
  playerOrder: [socket.id, ...],
  chatMessages: [],
  currentDrawer: socket.id,
  currentObject: string,
  guessedCorrectly: { [socket.id]: true },
  turnTimer: interval reference,
  roundPhase: "selection" | "drawing" | "leaderboard",
  currentDrawTimeLeft: number
}
*/

const DECISION_DURATION = 10; // seconds for object selection phase
const DRAW_DURATION = 70;     // seconds for drawing phase

// Helper: Compute Levenshtein distance between two strings.
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

// Helper: Returns similarity percentage (0–100) between two strings.
function similarity(str1, str2) {
  str1 = str1.toLowerCase().trim();
  str2 = str2.toLowerCase().trim();
  const distance = getLevenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 100;
  return (1 - distance / maxLen) * 100;
}

// Helper: Get n random objects (without duplicates) from objects.json.
function getRandomObjects(n) {
  let shuffled = objects.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// Start a new turn (object selection phase) for a given lobby.
function startNextTurn(lobby) {
  const game = games[lobby];
  if (!game) return;
  if (game.turnTimer) {
    clearInterval(game.turnTimer);
    game.turnTimer = null;
  }
  // Clear the canvas for the lobby.
  io.to(lobby).emit('clearCanvas');
  // Reset round state.
  game.currentObject = null;
  game.guessedCorrectly = {};
  game.roundPhase = "selection";
  
  // Choose the next drawer.
  if (game.playerOrder.length === 0) {
    game.currentDrawer = null;
    return;
  }
  let currentIndex = game.playerOrder.indexOf(game.currentDrawer);
  if (currentIndex === -1 || currentIndex === game.playerOrder.length - 1) {
    game.currentDrawer = game.playerOrder[0];
  } else {
    game.currentDrawer = game.playerOrder[currentIndex + 1];
  }
  // Inform lobby players about the new turn.
  io.to(lobby).emit('turnStarted', { currentDrawer: game.currentDrawer, duration: DECISION_DURATION });
  // Send three random object options only to the current drawer.
  const options = getRandomObjects(3);
  io.to(game.currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
  let timeLeft = DECISION_DURATION;
  game.turnTimer = setInterval(() => {
    timeLeft--;
    io.to(lobby).emit('turnCountdown', timeLeft);
    if (timeLeft <= 0) {
      clearInterval(game.turnTimer);
      game.turnTimer = null;
      io.to(game.currentDrawer).emit('turnTimeout');
      startNextTurn(lobby);
    }
  }, 1000);
}

// End the current round: show the leaderboard for 10 seconds, then start next turn.
function endRound(lobby) {
  const game = games[lobby];
  if (!game) return;
  if (game.turnTimer) {
    clearInterval(game.turnTimer);
    game.turnTimer = null;
  }
  const leaderboardData = Object.values(game.players).map(p => ({ nickname: p.nickname, score: p.score }));
  io.to(lobby).emit('leaderboard', leaderboardData);
  setTimeout(() => {
    io.to(lobby).emit('clearCanvas');
    startNextTurn(lobby);
  }, 10000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // 'joinGame' event: client sends { nickname, lobby, passcode }.
  socket.on('joinGame', (data) => {
    const { nickname, lobby, passcode } = data;
    // Validate lobby credentials from lobbies.json.
    const validLobby = lobbiesData.find(item => item.lobby === lobby && item.passcode === passcode);
    if (!validLobby) {
      socket.emit('lobbyError', 'Invalid lobby or passcode');
      return;
    }
    socket.join(lobby);
    socket.lobby = lobby;
    // Initialize game state for this lobby if needed.
    if (!games[lobby]) {
      games[lobby] = {
        players: {},
        playerOrder: [],
        chatMessages: [],
        currentDrawer: null,
        currentObject: null,
        guessedCorrectly: {},
        turnTimer: null,
        roundPhase: "selection",
        currentDrawTimeLeft: DRAW_DURATION
      };
    }
    const game = games[lobby];
    game.players[socket.id] = { nickname, score: 0 };
    game.playerOrder.push(socket.id);
    
    // Send initial game data to this client.
    socket.emit('init', {
      players: Object.values(game.players).map(p => ({ nickname: p.nickname, score: p.score })),
      chatMessages: game.chatMessages
    });
    io.to(lobby).emit('updatePlayers', Object.values(game.players).map(p => ({ nickname: p.nickname, score: p.score })));
    
    // If no current drawer exists, start the turn.
    if (!game.currentDrawer) {
      game.currentDrawer = socket.id;
      io.to(lobby).emit('turnStarted', { currentDrawer: game.currentDrawer, duration: DECISION_DURATION });
      const options = getRandomObjects(3);
      io.to(game.currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
      let timeLeft = DECISION_DURATION;
      game.turnTimer = setInterval(() => {
        timeLeft--;
        io.to(lobby).emit('turnCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(game.turnTimer);
          game.turnTimer = null;
          io.to(game.currentDrawer).emit('turnTimeout');
          startNextTurn(lobby);
        }
      }, 1000);
    }
  });
  
  // When the current drawer chooses an object.
  socket.on('objectChosen', (objectChosen) => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    if (socket.id === game.currentDrawer && !game.currentObject) {
      if (game.turnTimer) {
        clearInterval(game.turnTimer);
        game.turnTimer = null;
      }
      game.currentObject = objectChosen;
      game.roundPhase = "drawing";
      game.guessedCorrectly = {};
      let timeLeft = DRAW_DURATION;
      io.to(lobby).emit('drawPhaseStarted', { currentDrawer: game.currentDrawer, duration: DRAW_DURATION });
      game.turnTimer = setInterval(() => {
        timeLeft--;
        game.currentDrawTimeLeft = timeLeft;
        io.to(lobby).emit('drawPhaseCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(game.turnTimer);
          game.turnTimer = null;
          io.to(game.currentDrawer).emit('drawPhaseTimeout');
          endRound(lobby);
        }
      }, 1000);
    }
  });
  
  // Chat messages (and guess checking during drawing phase).
  socket.on('chatMessage', (message) => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    // If in drawing phase and sender is not the drawer, check the guess.
    if (game.currentObject && socket.id !== game.currentDrawer && game.roundPhase === "drawing") {
      if (!game.guessedCorrectly[socket.id]) {
        const guess = message.trim().toLowerCase();
        const answer = game.currentObject.trim().toLowerCase();
        const sim = similarity(guess, answer);
        if (sim >= 60) {
          game.guessedCorrectly[socket.id] = true;
          const remaining = game.currentDrawTimeLeft || 0;
          const points = Math.ceil((remaining + 1) / 10);
          game.players[socket.id].score += points;
          const correctMsg = `${game.players[socket.id].nickname} guessed correctly and earned ${points} points!`;
          io.to(lobby).emit('chatMessage', { nickname: "SYSTEM", message: correctMsg });
          io.to(lobby).emit('updatePlayers', Object.values(game.players).map(p => ({ nickname: p.nickname, score: p.score })));
          return;
        }
      }
    }
    // Otherwise, broadcast the chat message.
    const sender = game.players[socket.id] ? game.players[socket.id].nickname : 'Unknown';
    const chatData = { nickname: sender, message };
    game.chatMessages.push(chatData);
    if (game.chatMessages.length > 15) {
      game.chatMessages.shift();
    }
    io.to(lobby).emit('chatMessage', chatData);
  });
  
  // Broadcast drawing data from the current drawer.
  socket.on('drawing', (data) => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    if (socket.id === game.currentDrawer) {
      socket.to(lobby).emit('drawing', data);
    }
  });
  
  // Undo event.
  socket.on('undo', () => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    if (socket.id === game.currentDrawer) {
      io.to(lobby).emit('undo');
    }
  });
  
  // Clear event: clears the canvas (drawer‐initiated clear does not end the round).
  socket.on('clear', () => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    if (socket.id === game.currentDrawer) {
      io.to(lobby).emit('clearCanvas');
    }
  });
  
  // Give up: ends the round.
  socket.on('giveUp', () => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    if (socket.id === game.currentDrawer) {
      if (game.turnTimer) {
        clearInterval(game.turnTimer);
        game.turnTimer = null;
      }
      io.to(lobby).emit('clearCanvas');
      endRound(lobby);
    }
  });
  
  // On disconnect, remove the player from the lobby’s game state.
  socket.on('disconnect', () => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    if (game) {
      delete game.players[socket.id];
      game.playerOrder = game.playerOrder.filter(id => id !== socket.id);
      io.to(lobby).emit('updatePlayers', Object.values(game.players).map(p => ({ nickname: p.nickname, score: p.score })));
      if (socket.id === game.currentDrawer) {
        startNextTurn(lobby);
      }
    }
  });
  
  // (Optional) Relay remaining time for draw phase to update game state.
  socket.on('drawPhaseCountdown', (timeLeft) => {
    const lobby = socket.lobby;
    if (!lobby) return;
    const game = games[lobby];
    game.currentDrawTimeLeft = timeLeft;
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
