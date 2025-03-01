const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const objects = require('./objects.json'); // load objects from file

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

let players = {}; // { socket.id: { nickname, score } }
let playerOrder = []; // keeps the order of players
let chatMessages = []; // stores the last 15 messages
const MAX_CHAT_MESSAGES = 15;

let currentDrawer = null;
let currentObject = null;          // The chosen object for this round
let currentDrawTimeLeft = 0;       // Remaining seconds in drawing phase
let guessedCorrectly = {};         // Track which players guessed correctly this round
let turnTimer = null;

const DECISION_DURATION = 10; // seconds for object selection phase
const DRAW_DURATION = 70;     // seconds for drawing phase

// Helper: Compute Levenshtein distance between two strings
function getLevenshteinDistance(a, b) {
  const matrix = [];
  const aLen = a.length;
  const bLen = b.length;
  // increment along the first column of each row
  for (let i = 0; i <= bLen; i++) {
    matrix[i] = [i];
  }
  // increment each column in the first row
  for (let j = 0; j <= aLen; j++) {
    matrix[0][j] = j;
  }
  // Fill in the rest of the matrix
  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[bLen][aLen];
}

// Helper: Calculate similarity percentage between two strings
function similarity(str1, str2) {
  str1 = str1.toLowerCase().trim();
  str2 = str2.toLowerCase().trim();
  const distance = getLevenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 100;
  return ((1 - distance / maxLen) * 100);
}

// Helper: Get n random objects from the objects array (no duplicates)
function getRandomObjects(n) {
  let shuffled = objects.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// Start a new turn (object selection phase)
function startNextTurn() {
  if (turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
  // Clear canvas for all players
  io.emit('clearCanvas');
  // Reset round state
  currentObject = null;
  guessedCorrectly = {};
  
  // Choose next drawer
  if (playerOrder.length === 0) {
    currentDrawer = null;
    return;
  }
  let currentIndex = playerOrder.indexOf(currentDrawer);
  if (currentIndex === -1 || currentIndex === playerOrder.length - 1) {
    currentDrawer = playerOrder[0];
  } else {
    currentDrawer = playerOrder[currentIndex + 1];
  }
  
  // Inform everyone of the new turn (object selection phase)
  io.emit('turnStarted', { currentDrawer, duration: DECISION_DURATION });
  
  // Send object options only to the current drawer
  const options = getRandomObjects(3);
  io.to(currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
  
  let timeLeft = DECISION_DURATION;
  turnTimer = setInterval(() => {
    timeLeft--;
    io.emit('turnCountdown', timeLeft);
    if (timeLeft <= 0) {
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
    players[socket.id] = { nickname, score: 0 };
    playerOrder.push(socket.id);
    // Send initial data to this player
    socket.emit('init', {
      players: Object.values(players).map(p => ({ nickname: p.nickname, score: p.score })),
      chatMessages
    });
    // Update player list for everyone
    io.emit('updatePlayers', Object.values(players).map(p => ({ nickname: p.nickname, score: p.score })));
    // If no current drawer, start with this player
    if (!currentDrawer) {
      currentDrawer = socket.id;
      io.emit('turnStarted', { currentDrawer, duration: DECISION_DURATION });
      const options = getRandomObjects(3);
      io.to(currentDrawer).emit('objectSelection', { options, duration: DECISION_DURATION });
      let timeLeft = DECISION_DURATION;
      turnTimer = setInterval(() => {
        timeLeft--;
        io.emit('turnCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(turnTimer);
          turnTimer = null;
          io.to(currentDrawer).emit('turnTimeout');
          startNextTurn();
        }
      }, 1000);
    }
  });

  // When the current drawer chooses an object
  socket.on('objectChosen', (objectChosen) => {
    if (socket.id === currentDrawer && !currentObject) {
      if (turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
      }
      currentObject = objectChosen;
      guessedCorrectly = {};
      currentDrawTimeLeft = DRAW_DURATION;
      io.emit('drawPhaseStarted', { currentDrawer, duration: DRAW_DURATION });
      let timeLeft = DRAW_DURATION;
      turnTimer = setInterval(() => {
        timeLeft--;
        currentDrawTimeLeft = timeLeft;
        io.emit('drawPhaseCountdown', timeLeft);
        if (timeLeft <= 0) {
          clearInterval(turnTimer);
          turnTimer = null;
          io.to(currentDrawer).emit('drawPhaseTimeout');
          startNextTurn();
        }
      }, 1000);
    }
  });

  // Handle chat messages (and check guesses during drawing phase)
  socket.on('chatMessage', (message) => {
    // If in drawing phase and message is from a non-drawer
    if (currentObject && socket.id !== currentDrawer) {
      if (!guessedCorrectly[socket.id]) {
        const guess = message.trim().toLowerCase();
        const answer = currentObject.trim().toLowerCase();
        const sim = similarity(guess, answer);
        if (sim >= 60) {
          guessedCorrectly[socket.id] = true;
          // Calculate score: next multiple of 10 (higher than remaining time) divided by 10.
          // (Using currentDrawTimeLeft; add 1 to ensure if exactly a multiple, we go to next)
          const points = Math.ceil((currentDrawTimeLeft + 1) / 10);
          players[socket.id].score += points;
          const nickname = players[socket.id].nickname;
          const correctMsg = `${nickname} guessed correctly and earned ${points} points!`;
          io.emit('chatMessage', { nickname: "SYSTEM", message: correctMsg });
          // Update player list with new scores
          io.emit('updatePlayers', Object.values(players).map(p => ({ nickname: p.nickname, score: p.score })));
          return; // Do not broadcast the original guess
        }
      }
    }
    // Otherwise, broadcast chat message normally
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

  // Give up turn (applies to both selection and drawing phases)
  socket.on('giveUp', () => {
    if (socket.id === currentDrawer) {
      if (turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
      }
      io.emit('clearCanvas');
      startNextTurn();
    }
  });

  // When a player disconnects
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    playerOrder = playerOrder.filter(id => id !== socket.id);
    io.emit('updatePlayers', Object.values(players).map(p => ({ nickname: p.nickname, score: p.score })));
    if (socket.id === currentDrawer) {
      startNextTurn();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
