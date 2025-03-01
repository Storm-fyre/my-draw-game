const socket = io();

let nickname = "";
let lobby = "";
let isDrawing = false;
let currentPath = [];
let paths = []; // Stored drawing strokes.
let currentColor = "#000000";
let currentThickness = 4;
let isMyTurn = false;

// Modal elements
const nicknameModal = document.getElementById('nicknameModal');
const nicknameInput = document.getElementById('nicknameInput');
const joinBtn = document.getElementById('joinBtn');

const lobbyModal = document.getElementById('lobbyModal');
const lobbyNameInput = document.getElementById('lobbyNameInput');
const lobbyPasscodeInput = document.getElementById('lobbyPasscodeInput');
const joinLobbyBtn = document.getElementById('joinLobbyBtn');

const gameContainer = document.getElementById('gameContainer');

// Leaderboard overlay element
const leaderboardOverlay = document.getElementById('leaderboardOverlay');

// Nickname modal – after entering nickname, show lobby modal.
joinBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if(name) {
    nickname = name;
    nicknameModal.style.display = 'none';
    lobbyModal.style.display = 'flex';
  }
});

// Lobby modal event.
joinLobbyBtn.addEventListener('click', () => {
  const lobbyName = lobbyNameInput.value.trim();
  const passcode = lobbyPasscodeInput.value.trim();
  if(lobbyName && passcode) {
    lobby = lobbyName;
    socket.emit('joinGame', { nickname, lobby: lobbyName, passcode });
  }
});

// If lobby error is received.
socket.on('lobbyError', (msg) => {
  alert(msg);
  lobbyModal.style.display = 'flex';
});

// On successful join.
socket.on('init', (data) => {
  lobbyModal.style.display = 'none';
  gameContainer.style.display = 'flex';
  data.chatMessages.forEach(msg => addChatMessage(msg));
  updatePlayerList(data.players);
});

// Canvas setup.
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');

// Resize layout without wiping drawing strokes.
function resizeLayout() {
  const gameContainer = document.getElementById('gameContainer');
  const boxContainer = document.getElementById('boxContainer');
  const canvasContainer = document.getElementById('canvasContainer');
  const width = gameContainer.clientWidth;
  canvas.width = width;
  canvas.height = width;
  canvasContainer.style.height = width + "px";
  const totalHeight = gameContainer.clientHeight;
  const boxHeight = totalHeight - width;
  boxContainer.style.height = boxHeight + "px";
  redrawAll();
}

window.addEventListener('resize', resizeLayout);
window.addEventListener('orientationchange', resizeLayout);
document.addEventListener('DOMContentLoaded', resizeLayout);

// Redraw the canvas using stored strokes.
function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths.forEach(stroke => drawStroke(stroke, false));
}

// Wipe the canvas and clear stored strokes.
function wipeCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths = [];
}

// Toggle between chat and player list.
const toggleBoxBtn = document.getElementById('toggleBox');
const chatBox = document.getElementById('chatBox');
const playerBox = document.getElementById('playerBox');

toggleBoxBtn.addEventListener('click', () => {
  if(chatBox.style.display === 'none') {
    chatBox.style.display = 'block';
    playerBox.style.display = 'none';
  } else {
    chatBox.style.display = 'none';
    playerBox.style.display = 'block';
  }
});

// Chat input handling.
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChat');

sendChatBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if(msg) {
    socket.emit('chatMessage', msg);
    chatInput.value = '';
  }
});

function addChatMessage(data) {
  const p = document.createElement('p');
  p.textContent = `${data.nickname}: ${data.message}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function updatePlayerList(playersArr) {
  playerBox.innerHTML = "";
  playersArr.forEach(p => {
    const pElem = document.createElement('p');
    pElem.textContent = `${p.nickname} (${p.score})`;
    playerBox.appendChild(pElem);
  });
}

// Socket event handlers for chat and players.
socket.on('chatMessage', (data) => addChatMessage(data));
socket.on('updatePlayers', (playersArr) => updatePlayerList(playersArr));

// Handle drawing events.
socket.on('drawing', (data) => drawStroke(data, false));
socket.on('clearCanvas', () => wipeCanvas());
socket.on('undo', () => wipeCanvas()); // For simplicity.

// Turn and object-selection events.
const turnPrompt = document.getElementById('turnPrompt');
const promptText = document.getElementById('promptText');
const turnOptionsDiv = document.getElementById('turnOptions');
const countdownDisplay = document.getElementById('countdownDisplay');
const drawCountdown = document.getElementById('drawCountdown');

socket.on('turnStarted', (data) => {
  if(data.currentDrawer === socket.id) {
    isMyTurn = true;
    // Wait for object selection.
  } else {
    isMyTurn = false;
    turnPrompt.style.display = 'none';
  }
});

socket.on('turnCountdown', (timeLeft) => {
  if(turnPrompt.style.display !== 'none') {
    countdownDisplay.textContent = timeLeft;
  }
});

socket.on('turnTimeout', () => {
  turnPrompt.style.display = 'none';
  isMyTurn = false;
});

socket.on('objectSelection', (data) => {
  if(data.options && data.options.length > 0) {
    isMyTurn = true;
    turnPrompt.style.display = 'flex';
    promptText.textContent = "Choose an object to draw:";
    turnOptionsDiv.innerHTML = '';
    data.options.forEach(option => {
      const btn = document.createElement('button');
      btn.textContent = option;
      btn.addEventListener('click', () => {
        socket.emit('objectChosen', option);
        turnPrompt.style.display = 'none';
      });
      turnOptionsDiv.appendChild(btn);
    });
    countdownDisplay.textContent = data.duration;
  }
});

socket.on('drawPhaseStarted', (data) => {
  if(data.currentDrawer === socket.id) {
    isMyTurn = true;
    turnPrompt.style.display = 'none';
    drawCountdown.style.display = 'block';
    drawCountdown.textContent = data.duration;
  } else {
    isMyTurn = false;
    drawCountdown.style.display = 'none';
  }
});

socket.on('drawPhaseCountdown', (timeLeft) => {
  if(drawCountdown.style.display !== 'none') {
    drawCountdown.textContent = timeLeft;
  }
});

socket.on('drawPhaseTimeout', () => {
  drawCountdown.style.display = 'none';
  isMyTurn = false;
});

// Show leaderboard overlay for 10 seconds when a round ends.
socket.on('leaderboard', (data) => {
  leaderboardOverlay.innerHTML = "<h2>Leaderboard</h2>";
  data.forEach(item => {
    const p = document.createElement('p');
    p.textContent = `${item.nickname}: ${item.score}`;
    leaderboardOverlay.appendChild(p);
  });
  leaderboardOverlay.style.display = 'flex';
  setTimeout(() => {
    leaderboardOverlay.style.display = 'none';
  }, 10000);
});

// Normalized drawing functions.
function getNormalizedPos(e) {
  const rect = canvas.getBoundingClientRect();
  let x, y;
  if(e.touches && e.touches.length > 0) {
    x = e.touches[0].clientX - rect.left;
    y = e.touches[0].clientY - rect.top;
  } else {
    x = e.clientX - rect.left;
    y = e.clientY - rect.top;
  }
  return { x: x / canvas.width, y: y / canvas.height };
}

function startDrawing(e) {
  if (!isMyTurn) return;
  isDrawing = true;
  currentPath = [];
  const pos = getNormalizedPos(e);
  currentPath.push(pos);
}

function drawingMove(e) {
  if (!isMyTurn || !isDrawing) return;
  const pos = getNormalizedPos(e);
  currentPath.push(pos);
  drawStroke({ path: currentPath, color: currentColor, thickness: currentThickness }, true);
  socket.emit('drawing', { path: currentPath, color: currentColor, thickness: currentThickness });
}

function stopDrawing(e) {
  if (!isMyTurn) return;
  if(isDrawing) {
    paths.push({ path: currentPath, color: currentColor, thickness: currentThickness });
  }
  isDrawing = false;
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', drawingMove);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);
canvas.addEventListener('touchstart', (e) => { startDrawing(e); });
canvas.addEventListener('touchmove', (e) => { drawingMove(e); e.preventDefault(); });
canvas.addEventListener('touchend', (e) => { stopDrawing(e); });

function drawStroke(data, emitLocal) {
  if(!data.path || data.path.length < 2) return;
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(data.path[0].x * canvas.width, data.path[0].y * canvas.height);
  for(let i = 1; i < data.path.length - 1; i++) {
    const x_i = data.path[i].x * canvas.width;
    const y_i = data.path[i].y * canvas.height;
    const x_next = data.path[i+1].x * canvas.width;
    const y_next = data.path[i+1].y * canvas.height;
    const midX = (x_i + x_next) / 2;
    const midY = (y_i + y_next) / 2;
    ctx.quadraticCurveTo(x_i, y_i, midX, midY);
  }
  let lastPoint = data.path[data.path.length - 1];
  ctx.lineTo(lastPoint.x * canvas.width, lastPoint.y * canvas.height);
  ctx.stroke();
}

// Drawing tools.
const thicknessButtons = document.querySelectorAll('.thickness');
thicknessButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentThickness = parseInt(btn.getAttribute('data-size'));
  });
});

const colorButtons = document.querySelectorAll('.color');
colorButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentColor = btn.getAttribute('data-color');
  });
});

// Draw control buttons.
document.getElementById('undoBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('undo');
  }
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('clear');
    wipeCanvas();
  }
});
document.getElementById('giveUpBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('giveUp');
    wipeCanvas();
    isMyTurn = false;
    drawCountdown.style.display = 'none';
  }
});

// On‑screen keyboard adjustments: simply recalc layout without clearing the canvas.
chatInput.addEventListener('focus', () => { resizeLayout(); });
chatInput.addEventListener('blur', () => { resizeLayout(); });
