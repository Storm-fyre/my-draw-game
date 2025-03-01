const socket = io();

let nickname = "";
let isDrawing = false;
let currentPath = [];
let paths = []; // stored drawing strokes (do NOT clear on resize)
let currentColor = "#000000";
let currentThickness = 4;
let isMyTurn = false;

// Modal elements
const nicknameModal = document.getElementById('nicknameModal');
const nicknameInput = document.getElementById('nicknameInput');
const joinNicknameBtn = document.getElementById('joinNicknameBtn');

const lobbyModal = document.getElementById('lobbyModal');
const lobbyListDiv = document.getElementById('lobbyList');

const passcodeModal = document.getElementById('passcodeModal');
const selectedLobbyNameSpan = document.getElementById('selectedLobbyName');
const passcodeInput = document.getElementById('passcodeInput');
const joinLobbyBtn = document.getElementById('joinLobbyBtn');
const passcodeError = document.getElementById('passcodeError');

const gameContainer = document.getElementById('gameContainer');

// After entering nickname, send to server and show lobby selection
joinNicknameBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if(name) {
    nickname = name;
    socket.emit('setNickname', nickname);
    nicknameModal.style.display = 'none';
  }
});

// When server sends available lobby list, show lobbyModal
socket.on('lobbyList', (lobbies) => {
  lobbyListDiv.innerHTML = '';
  lobbies.forEach(lobby => {
    const btn = document.createElement('button');
    btn.textContent = lobby;
    btn.addEventListener('click', () => {
      // Open passcode modal for selected lobby
      selectedLobbyNameSpan.textContent = lobby;
      passcodeModal.style.display = 'flex';
      // Store selected lobby in a variable on the client side
      passcodeModal.dataset.lobby = lobby;
    });
    lobbyListDiv.appendChild(btn);
  });
  lobbyModal.style.display = 'flex';
});

// When joining lobby after entering passcode
joinLobbyBtn.addEventListener('click', () => {
  const lobbyName = passcodeModal.dataset.lobby;
  const passcode = passcodeInput.value.trim();
  socket.emit('joinLobby', { lobbyName, passcode });
});

// Handle lobby join error
socket.on('lobbyJoinError', (msg) => {
  passcodeError.style.display = 'block';
  passcodeError.textContent = msg;
});

// Once joined lobby successfully, hide lobby and passcode modals and show game container
socket.on('init', (data) => {
  lobbyModal.style.display = 'none';
  passcodeModal.style.display = 'none';
  gameContainer.style.display = 'flex';
  // Initialize chat messages and players list
  data.chatMessages.forEach(msg => {
    addChatMessage(msg);
  });
  updatePlayerList(data.players);
});

// Canvas setup
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');

// Dynamic layout: adjust canvas and bottom box without clearing stored strokes
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

  // Instead of clearing strokes, simply redraw them
  redrawAll();
}

window.addEventListener('resize', resizeLayout);
window.addEventListener('orientationchange', resizeLayout);
document.addEventListener('DOMContentLoaded', resizeLayout);

// Toggle between chat and player list
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
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChat');

sendChatBtn.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if(msg) {
    socket.emit('chatMessage', msg);
    chatInput.value = '';
  }
});

// Append a chat message
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

// Socket events for chat and player list updates
socket.on('chatMessage', (data) => {
  addChatMessage(data);
});
socket.on('updatePlayers', (playersArr) => {
  updatePlayerList(playersArr);
});

// Handle drawing events from server
socket.on('drawing', (data) => {
  drawStroke(data, false);
});
socket.on('clearCanvas', () => {
  // Clear only the visual canvas; do not reset stored strokes here.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});
socket.on('resetPaths', () => {
  // When a clear action is intentional, remove stored strokes.
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
    // Object selection will be handled via "objectSelection" event.
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

// Object selection: show three buttons for the drawer
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

// Draw stroke with smooth quadratic curves using normalized coordinates
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

// Redraw all strokes without clearing the stored paths
function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths.forEach(stroke => {
    drawStroke(stroke, false);
  });
}

// Undo last stroke
function undoLastStroke() {
  paths.pop();
  redrawAll();
}

// Drawing tools: thickness selection
const thicknessButtons = document.querySelectorAll('.thickness');
thicknessButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentThickness = parseInt(btn.getAttribute('data-size'));
  });
});

// Drawing tools: color selection
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
  }
});
document.getElementById('giveUpBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('giveUp');
    isMyTurn = false;
    drawCountdown.style.display = 'none';
  }
});

// Adjust layout when chat input is focused/blurred (without clearing canvas)
chatInput.addEventListener('focus', () => {
  resizeLayout();
});
chatInput.addEventListener('blur', () => {
  resizeLayout();
});
