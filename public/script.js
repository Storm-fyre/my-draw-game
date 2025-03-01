const socket = io();

let nickname = "";
let isDrawing = false;
let currentPath = [];
let paths = []; // stored complete strokes (for redrawing)
let currentColor = "#000000";
let currentThickness = 4;
let isMyTurn = false;

// For non-drawing players: store the current remote stroke (in progress)
let currentRemoteStroke = null;

// For dash hint (object reveal)
let currentObjectStr = null;
let currentDrawTime = null;

// --- Modal Elements ---
const nicknameModal = document.getElementById('nicknameModal');
const nicknameInput = document.getElementById('nicknameInput');
const joinBtn = document.getElementById('joinBtn');

const lobbyModal = document.getElementById('lobbyModal');
const lobbyButtonsDiv = document.getElementById('lobbyButtons');
const lobbyPasscodeContainer = document.getElementById('lobbyPasscodeContainer');
const selectedLobbyNameElem = document.getElementById('selectedLobbyName');
const lobbyPasscodeInput = document.getElementById('lobbyPasscodeInput');
const joinLobbyBtn = document.getElementById('joinLobbyBtn');

// --- After entering nickname, show lobby selection ---
joinBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if(name) {
    nickname = name;
    nicknameModal.style.display = 'none';
    // Fetch lobby list from the server
    fetch('/lobbies')
      .then(res => res.json())
      .then(data => {
        lobbyButtonsDiv.innerHTML = '';
        data.forEach(lobby => {
          const btn = document.createElement('button');
          btn.textContent = lobby.name;
          if (lobby.passcode === "") {
            btn.addEventListener('click', () => {
              socket.emit('joinLobby', { lobbyName: lobby.name, passcode: "" });
            });
          } else {
            btn.addEventListener('click', () => {
              lobbyButtonsDiv.style.display = 'none';
              lobbyPasscodeContainer.style.display = 'block';
              selectedLobbyNameElem.textContent = lobby.name;
              selectedLobbyNameElem.setAttribute('data-lobby', lobby.name);
            });
          }
          lobbyButtonsDiv.appendChild(btn);
        });
        lobbyModal.style.display = 'flex';
      });
  }
});

// Handle joining lobby after passcode entry
joinLobbyBtn.addEventListener('click', () => {
  const lobbyName = selectedLobbyNameElem.getAttribute('data-lobby');
  const passcode = lobbyPasscodeInput.value.trim();
  if(lobbyName && passcode) {
    socket.emit('joinLobby', { lobbyName, passcode });
  }
});

socket.on('lobbyJoined', (data) => {
  lobbyModal.style.display = 'none';
  socket.emit('setNickname', nickname);
});

socket.on('lobbyError', (data) => {
  alert(data.message);
  lobbyButtonsDiv.style.display = 'block';
  lobbyPasscodeContainer.style.display = 'none';
});

// --- Canvas setup ---
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const dashHintDiv = document.getElementById('dashHint');
const drawControlsDiv = document.getElementById('drawControls');

// Function to redraw complete strokes and current remote stroke (if any)
function redrawStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths.forEach(stroke => {
    drawStroke(stroke, false);
  });
  if (currentRemoteStroke) {
    drawStroke(currentRemoteStroke, false);
  }
}

// Dynamic layout: canvas remains square; bottom box adjusts accordingly.
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

  redrawStrokes();
  updateDashHint();
}

window.addEventListener('resize', resizeLayout);
window.addEventListener('orientationchange', resizeLayout);
document.addEventListener('DOMContentLoaded', resizeLayout);

// --- Chat and Player Box ---
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
    pElem.textContent = `${p.rank}. ${p.nickname} (${p.score})`;
    playerBox.appendChild(pElem);
  });
}

// --- Dash hint update function ---
// Reveal schedule:
// Single word: ≤50 sec: reveal letter1, ≤30: letter2, ≤10: letter3.
// Two words: ≤50: reveal first letter of word1, ≤30: reveal first letter of word2, ≤10: reveal second letter of word1.
// Three words: ≤50: reveal first letter of word1, ≤30: reveal first letter of word2, ≤10: reveal first letter of word3.
function updateDashHint() {
  if (isMyTurn || !currentObjectStr) {
    dashHintDiv.textContent = "";
    return;
  }
  let words = currentObjectStr.split(' ');
  let hintWords = [];
  if (words.length === 1) {
    let word = words[0];
    let revealed = "";
    if (currentDrawTime <= 50) { revealed = word.charAt(0); }
    if (currentDrawTime <= 30 && word.length > 1) { revealed += word.charAt(1); }
    if (currentDrawTime <= 10 && word.length > 2) { revealed += word.charAt(2); }
    let display = "";
    for (let i = 0; i < word.length; i++) {
      display += (i < revealed.length ? word.charAt(i) : "_") + " ";
    }
    hintWords.push(display.trim());
  } else if (words.length === 2) {
    let [word1, word2] = words;
    let r1 = "", r2 = "";
    if (currentDrawTime <= 50) { r1 = word1.charAt(0); }
    if (currentDrawTime <= 30) { r2 = word2.charAt(0); }
    if (currentDrawTime <= 10 && word1.length > 1) { r1 += word1.charAt(1); }
    let disp1 = "";
    for (let i = 0; i < word1.length; i++) {
      disp1 += (i < r1.length ? word1.charAt(i) : "_") + " ";
    }
    let disp2 = "";
    for (let i = 0; i < word2.length; i++) {
      disp2 += (i < r2.length ? word2.charAt(i) : "_") + " ";
    }
    hintWords.push(disp1.trim());
    hintWords.push(disp2.trim());
  } else if (words.length === 3) {
    let [word1, word2, word3] = words;
    let r1 = "", r2 = "", r3 = "";
    if (currentDrawTime <= 50) { r1 = word1.charAt(0); }
    if (currentDrawTime <= 30) { r2 = word2.charAt(0); }
    if (currentDrawTime <= 10) { r3 = word3.charAt(0); }
    let disp1 = "";
    for (let i = 0; i < word1.length; i++) {
      disp1 += (i < r1.length ? word1.charAt(i) : "_") + " ";
    }
    let disp2 = "";
    for (let i = 0; i < word2.length; i++) {
      disp2 += (i < r2.length ? word2.charAt(i) : "_") + " ";
    }
    let disp3 = "";
    for (let i = 0; i < word3.length; i++) {
      disp3 += (i < r3.length ? word3.charAt(i) : "_") + " ";
    }
    hintWords.push(disp1.trim());
    hintWords.push(disp2.trim());
    hintWords.push(disp3.trim());
  }
  dashHintDiv.textContent = hintWords.join("   ");
}

// --- Socket events ---
socket.on('init', (data) => {
  updatePlayerList(data.players);
  if(data.canvasStrokes) {
    paths = data.canvasStrokes;
    redrawStrokes();
  }
});

socket.on('chatMessage', (data) => {
  addChatMessage(data);
});

socket.on('updatePlayers', (playersArr) => {
  updatePlayerList(playersArr);
});

socket.on('drawing', (data) => {
  if (!isMyTurn) {
    currentRemoteStroke = data;
    redrawStrokes();
  }
});

socket.on('strokeComplete', (data) => {
  if (!isMyTurn) {
    paths.push(data);
    currentRemoteStroke = null;
    redrawStrokes();
  }
});

socket.on('clearCanvas', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths = [];
  currentRemoteStroke = null;
});

socket.on('undo', () => {
  undoLastStroke();
});

// Turn and object selection events
const turnPrompt = document.getElementById('turnPrompt');
const promptText = document.getElementById('promptText');
const turnOptionsDiv = document.getElementById('turnOptions');
const countdownDisplay = document.getElementById('countdownDisplay');
const drawCountdown = document.getElementById('drawCountdown');

socket.on('turnStarted', (data) => {
  if(data.currentDrawer === socket.id) {
    isMyTurn = true;
    dashHintDiv.textContent = "";
    turnPrompt.style.display = 'flex';
  } else {
    isMyTurn = false;
    // Show a message including the player's rank and name.
    turnPrompt.style.display = 'flex';
    promptText.textContent = `Player #${data.currentDrawerRank} (${data.currentDrawerName}) is choosing a word...`;
    turnOptionsDiv.innerHTML = "";
  }
  drawControlsDiv.style.display = (data.currentDrawer === socket.id) ? 'block' : 'none';
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

// When the drawing player chooses an object, non-drawing players hide the turn prompt countdown.
socket.on('objectChosenBroadcast', (data) => {
  currentObjectStr = data.object;
  currentDrawTime = DRAW_DURATION;
  updateDashHint();
  // Hide the turn prompt for non-drawing players
  if (!isMyTurn) {
    turnPrompt.style.display = 'none';
  }
});

socket.on('drawPhaseStarted', (data) => {
  if(data.currentDrawer === socket.id) {
    isMyTurn = true;
    turnPrompt.style.display = 'none';
    drawCountdown.style.display = 'block';
    drawCountdown.textContent = data.duration;
    dashHintDiv.textContent = "";
    drawControlsDiv.style.display = 'block';
  } else {
    isMyTurn = false;
    drawCountdown.style.display = 'block';
    drawCountdown.textContent = data.duration;
    drawControlsDiv.style.display = 'none';
  }
});

socket.on('drawPhaseCountdown', (timeLeft) => {
  currentDrawTime = timeLeft;
  drawCountdown.textContent = timeLeft;
  updateDashHint();
});

socket.on('drawPhaseTimeout', () => {
  drawCountdown.style.display = 'none';
  isMyTurn = false;
  dashHintDiv.textContent = "";
});

// --- Drawing functions ---
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
    let stroke = { path: currentPath, color: currentColor, thickness: currentThickness };
    paths.push(stroke);
    socket.emit('strokeComplete', stroke);
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

function undoLastStroke() {
  paths.pop();
  redrawStrokes();
}

// --- Drawing tools ---
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

// --- Draw control buttons ---
document.getElementById('undoBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('undo');
    undoLastStroke();
  }
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('clear');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paths = [];
    currentRemoteStroke = null;
  }
});
document.getElementById('giveUpBtn').addEventListener('click', () => {
  if(isMyTurn) {
    socket.emit('giveUp');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paths = [];
    currentRemoteStroke = null;
    isMyTurn = false;
    drawCountdown.style.display = 'none';
    dashHintDiv.textContent = "";
  }
});

// --- Keyboard adjustments ---
chatInput.addEventListener('focus', () => {
  resizeLayout();
});
chatInput.addEventListener('blur', () => {
  resizeLayout();
});
