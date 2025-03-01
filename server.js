const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Load objects from objects.json
let objectList = [];
try {
  const data = fs.readFileSync('objects.json', 'utf8');
  objectList = JSON.parse(data);
} catch (err) {
  console.error("Error reading objects.json:", err);
}

let players = {};         // { socket.id: { nickname } }
let scores = {};          // { socket.id: score }
let playerOrder = [];     // Order of players joining
let chatMessages = [];    // Stores last 15 messages
const MAX_CHAT_MESSAGES = 15;

let currentDrawer = null;
let currentObject = null; // The chosen object (correct answer) for this round
let phase = "waiting";    // "objectSelection", "drawing", or "waiting"
let turnTimer = null;
const DECISION_DURATION = 10; // Seconds for object selection phase
const DRAW_DURATION = 70;     // Seconds for drawing phase
let drawingTimeLeft = 0;      // Updated during drawing phase
let roundGuesses = {};        // Tracks which players already guessed correctly

// Helper: pick 3 distinct random objects from objectList
function getRandomObjects() {
  let options = [];
  if(objectList.length <= 3) {
    options = objectList.slice();
  } else {
    let indices = [];
    while(indices.length < 3) {
      let idx = Math.floor(Math.random() * objectList.length);
      if (!indices.includes(idx)) {
        indices.push(idx);
        options.push(objectList[idx]);
      }
    }
  }
  return options;
}

// Helper: Compute Levenshtein distance (for fuzzy matching)
function getLevenshteinDistance(a, b) {
  if(a.length === 0) return b.length;
  if(b.length === 0) return a.length;
  let matrix = [];
  for (let i = 0; i <= b.length; i++){
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++){
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++){
    for (let j = 1; j <= a.length; j++){
      if(b.charAt(i-1) === a.charAt(j-1)){
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(matrix[i-1][j-1] + 1,
                                 matrix[i][j-1] + 1,
                                 matrix[i-1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
}

function getSimilarity(guess, answer) {
  guess = guess.trim().toLowerCase();
  answer = answer.trim().toLowerCase();
  const distance = getLevenshteinDistance(guess, answer);
  const maxLen = Math.max(guess.length, answer.length);
  if(maxLen === 0) return 100;
  return (1 - distance / maxLen) * 100;
}

// Helper: update player list (including scores)
function updatePlayersList() {
  const playersList = Object.keys(players).map(id => ({
    nickname: players[id].nickname,
    score: scores[id] || 0
  }));
  io.emit('updatePlayers', playersList);
}

// Helper: start next turn
function startNextTurn() {
  if(turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
  // Clear canvas for all players
  io.emit('clearCanvas');
  // Reset round state
  phase = "waiting";
  currentObject = null;
  roundGuesses = {};

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
  // Start object selection phase
  phase = "objectSelection";
  io.emit('turnStarted', { currentDrawer, duration: DECISION_DURATION });
  // Send 3 random object options only to current drawer
  io.to(currentDrawer).emit('objectOptions', { options: getRandomObjects() });
  let timeLeft = DECISION_DURATION;
  turnTimer = setInterval(() => {
    timeLeft--;
    io.emit('turnCountdown', timeLeft);
    if(timeLeft <= 0) {
      clearInterval(turnTimer);
      turnTimer = null;
      io.to(currentDrawer).emit('objectSelectionTimeout');
      startNextTurn();
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on('setNickname', (nickname) => {
    players[socket.id] = { nickname };
    scores[socket.id] = 0;
    playerOrder.push(socket.id);
    // Send initial data to this player
    socket.emit('init', {
      players: Object.keys(players).map(id => ({
        nickname: players[id].nickname,
        score: scores[id]
      })),
      chatMessages
    });
    updatePlayersList();
    // If no current drawer exists, start the turn with this player.
    if (!currentDrawer) {
      currentDrawer = socket.id;
      phase = "objectSelection";
      io.emit('turnStarted', { currentDrawer, duration: DECISION_DURATION });
      io.to(currentDrawer).emit('objectOptions', { options: getRandomObjects() });
      let timeLeft = DECISION_DURATION;
      turnTimer = setInterval(() => {
        timeLeft--;
        io.emit('turnCountdown', timeLeft);
        if(timeLeft <= 0) {
          clearInterval(turnTimer);
          turnTimer = null;
          io.to(currentDrawer).emit('objectSelectionTimeout');
          startNextTurn();
        }
      }, 1000);
    }
  });
  
  // Handle chat messages (and process guesses in drawing phase)
  socket.on('chatMessage', (message) => {
    const senderNickname = players[socket.id] ? players[socket.id].nickname : 'Unknown';
    const chatData = { nickname: senderNickname, message };
    
    // Process guess if in drawing phase and sender is not the drawer
    if (phase === "drawing" && currentObject && socket.id !== currentDrawer) {
      if (!roundGuesses[socket.id]) {
        let similarity = getSimilarity(message, currentObject);
        if (similarity >= 60) {
          // Award score: points = ceil(remainingTime/10)
          let points = Math.ceil(drawingTimeLeft / 10);
          scores[socket.id] = (scores[socket.id] || 0) + points;
          roundGuesses[socket.id] = true;
          updatePlayersList();
          io.emit('chatMessage', { nickname: 'System', message: `${senderNickname} guessed correctly and earned ${points} points!` });
        }
      }
    }
    
    // Store and broadcast chat message
    chatMessages.push(chatData);
    if (chatMessages.length > MAX_CHAT_MESSAGES) {
      chatMessages.shift();
    }
    io.emit('chatMessage', chatData);
  });
  
  // Broadcast drawing data only if sent by current drawer during drawing phase
  socket.on('drawing', (data) => {
    if (socket.id === currentDrawer && phase === "drawing") {
      socket.broadcast.emit('drawing', data);
    }
  });
  
  socket.on('undo', () => {
    if (socket.id === currentDrawer && phase === "drawing") {
      io.emit('undo');
    }
  });
  
  socket.on('clear', () => {
    if (socket.id === currentDrawer && phase === "drawing") {
      io.emit('clearCanvas');
    }
  });
  
  // "Give Up" ends the round immediately
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
  
  // Handle object chosen by the current drawer during object selection phase
  socket.on('objectChosen', (chosenObject) => {
    if (socket.id === currentDrawer && phase === "objectSelection") {
      currentObject = chosenObject;
      phase = "drawing";
      if (turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
      }
      io.emit('objectChosen', { currentDrawer, chosenObject });
      // Start drawing phase timer
      io.emit('drawPhaseStarted', { currentDrawer, duration: DRAW_DURATION });
      drawingTimeLeft = DRAW_DURATION;
      turnTimer = setInterval(() => {
        drawingTimeLeft--;
        io.emit('drawPhaseCountdown', drawingTimeLeft);
        if (drawingTimeLeft <= 0) {
          clearInterval(turnTimer);
          turnTimer = null;
          io.to(currentDrawer).emit('drawPhaseTimeout');
          startNextTurn();
        }
      }, 1000);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    delete scores[socket.id];
    playerOrder = playerOrder.filter(id => id !== socket.id);
    updatePlayersList();
    if (socket.id === currentDrawer) {
      startNextTurn();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
