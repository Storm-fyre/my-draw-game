const socket = io();

let nickname = "";
let isDrawing = false;
let currentPath = [];
let paths = []; // stores strokes (for undo) in normalized coordinates
let currentColor = "#000000";
let currentThickness = 4;
let isMyTurn = false;

// Modals
const nicknameModal = document.getElementById('nicknameModal');
const nicknameInput = document.getElementById('nicknameInput');
const joinBtn = document.getElementById('joinBtn');

const lobbyModal = document.getElementById('lobbyModal');
const lobbiesListDiv = document.getElementById('lobbiesList');
const lobbyPasscodeInput = document.getElementById('lobbyPasscode');
const lobbyJoinBtn = document.getElementById('lobbyJoinBtn');
const lobbyErrorP = document.getElementById('lobbyError');

// When nickname is set, emit to server and then show lobby selection.
joinBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if(name) {
    nickname = name;
    socket.emit('setNickname', nickname);
    nicknameModal.style.display = 'none';
    // Lobby modal will be shown when server sends 'lobbiesList'
  }
});

// When lobbyJoinBtn is clicked, join the selected lobby.
lobbyJoinBtn.addEventListener('click', () => {
  const selectedLobbyBtn = document.querySelector('.lobbyBtn.selected');
  if (!selectedLobbyBtn) {
    lobbyErrorP.textContent = "Please select a lobby.";
    return;
  }
  const lobbyName = selectedLobbyBtn.getAttribute('data-lobby');
  const passcode = lobbyPasscodeInput.value.trim();
  socket.emit('joinLobby', { lobbyName, passcode });
});

// When server sends list of lobbies, show them in the lobby modal.
socket.on('lobbiesList', (lobbiesConfig) => {
  lobbiesListDiv.innerHTML = "";
  lobbiesConfig.forEach(lobby => {
    const btn = document.createElement('button');
    btn.textContent = lobby.name;
    btn.className = 'lobbyBtn';
    btn.setAttribute('data-lobby', lobby.name);
    btn.addEventListener('click', () => {
      // Mark selected button.
      document.querySelectorAll('.lobbyBtn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    lobbiesListDiv.appendChild(btn);
  });
  lobbyModal.style.display = 'flex';
});

// Handle lobby error from server.
socket.on('lobbyError', (errMsg) => {
  lobbyErrorP.textContent = errMsg;
});

// Canvas setup
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');

// Repaint canvas without clearing stored strokes
function repaintCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths.forEach(stroke => {
    drawStroke(stroke, false);
  });
}

// Dynamic layout: make canvas square without clearing strokes.
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

  // Repaint the drawing without clearing the saved strokes.
  repaintCanvas();
}

window.addEventListener('resize', resizeLayout);
window.addEventListener('orientationchange', resizeLayout);
document.addEventListener('DOMContentLoaded', resizeLayout);

// Do not clear canvas when keyboard shows up. Instead, adjust layout.
const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('focus', () => {
  resizeLayout();
});
chatInput.addEventListener('blur', () => {
  resizeLayout();
});

// Toggle between chat and players list
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

// Chat input
const sendChatBtn = document.getElementById('sendChat');
sendChatBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if(msg) {
    socket.emit('chatMessage', msg);
    chatInput.value = '';
  }
});

// Append chat messages
function addChatMessage(data) {
  const p = document.createElement('p');
  p.textContent = `${data.nickname}: ${data.message}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Update players list (with scores)
function updatePlayerList(playersArr) {
  playerBox.innerHTML = "";
  playersArr.forEach(p => {
    const pElem = document.createElement('p');
    pElem.textContent = `${p.nickname} (${p.score})`;
    playerBox.appendChild(pElem);
  });
}

// Socket events for lobby game data
socket.on('init', (data) => {
  data.chatMessages.forEach(msg => addChatMessage(msg));
  updatePlayerList(data.players);
});

socket.on('chatMessage', (data) => addChatMessage(data));
socket.on('updatePlayers', (playersArr) => updatePlayerList(playersArr));

// Drawing events
socket.on('drawing', (data) => {
  drawStroke(data, false);
});
socket.on('clearCanvas', () => {
  // When canvas is cleared as a game action, clear strokes.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths = [];
});
socket.on('undo', () => {
  undoLastStroke();
});

// Turn events
const turnPrompt = document.getElementById('turnPrompt');
const promptText = document.getElementById('promptText');
const turnOptionsDiv = document.getElementById('turnOptions');
const countdownDisplay = document.getElementById('countdownDisplay');
const drawCountdown = document.getElementById('drawCountdown');

socket.on('turnStarted', (data) => {
  if(data.currentDrawer === socket.id) {
    isMyTurn = true;
    // Object selection phase: wait for objectSelection event.
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

// Object selection event: show three buttons.
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

// Draw phase events
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

// Normalize pointer position to relative coordinates (0 to 1)
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

// Draw stroke with smooth quadratic curves using normalized coordinates.
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

// Permanently clear canvas and stored strokes.
function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths = [];
}

function undoLastStroke() {
  paths.pop();
  repaintCanvas();
}

// Drawing tools: thickness and color selection
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

// Draw control buttons
document.getElementById('undoBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('undo');
    undoLastStroke();
  }
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('clear');
    clearCanvas();
  }
});
document.getElementById('giveUpBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('giveUp');
    clearCanvas();
    isMyTurn = false;
    drawCountdown.style.display = 'none';
  }
});
