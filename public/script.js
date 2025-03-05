const socket = io();

let nickname = "";
let isDrawing = false;
let currentPath = [];
let paths = []; // stored complete strokes
let currentColor = "#000000";
// Default thickness is now 2px.
let currentThickness = 2;
let isMyTurn = false;

// For non-drawing players: store current remote stroke
let currentRemoteStroke = null;

// For dash hint (object reveal)
let currentObjectStr = null;
let currentDrawTime = null;

// Global variable to store current drawer’s uppercase name
let globalDrawerName = "";

// Flag to track current view (true = Chat, false = Players)
let isChatView = true;

// Flag for keyboard activity
let isKeyboardActive = false;

// Timer for clearing object display/dash hints after drawing phase (70 sec)
let drawPhaseObjectTimer = null;

// Current game cluster (default from server is "superhero")
let currentCluster = "superhero";

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
    fetch('/lobbies')
      .then(res => res.json())
      .then(data => {
        lobbyButtonsDiv.innerHTML = '';
        data.forEach(lobby => {
          const lobbyName = Object.keys(lobby)[0];
          const lobbyPasscode = lobby[lobbyName];
          const btn = document.createElement('button');
          btn.textContent = lobbyName;
          if (lobbyPasscode === "") {
            btn.addEventListener('click', () => {
              socket.emit('joinLobby', { lobbyName: lobbyName, passcode: "" });
            });
          } else {
            btn.addEventListener('click', () => {
              lobbyButtonsDiv.style.display = 'none';
              lobbyPasscodeContainer.style.display = 'block';
              selectedLobbyNameElem.textContent = lobbyName;
              selectedLobbyNameElem.setAttribute('data-lobby', lobbyName);
            });
          }
          lobbyButtonsDiv.appendChild(btn);
        });
        lobbyModal.style.display = 'flex';
      });
  }
});

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
// The dash hint element is now positioned at the bottom via CSS.
const dashHintDiv = document.getElementById('dashHint');
const drawControlsDiv = document.getElementById('drawControls');
const objectDisplayElem = document.getElementById('objectDisplay');
const drawCountdown = document.getElementById('drawCountdown');

function redrawStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paths.forEach(stroke => drawStroke(stroke, false));
  if (currentRemoteStroke) drawStroke(currentRemoteStroke, false);
}

// Adjust layout when keyboard is active.
function adjustLayoutForKeyboard(active) {
  const gameContainer = document.getElementById('gameContainer');
  const canvasContainer = document.getElementById('canvasContainer');
  const boxContainer = document.getElementById('boxContainer');
  const toolsBar = document.getElementById('toolsBar');
  if (active) {
    isKeyboardActive = true;
    // Switch to horizontal layout.
    gameContainer.style.flexDirection = 'row';
    canvasContainer.style.width = '75%';
    let newWidth = gameContainer.clientWidth * 0.75;
    canvas.width = newWidth;
    canvas.height = newWidth; // square canvas
    canvasContainer.style.height = newWidth + "px";
    // Message box takes 25% of width and height equals canvas height.
    boxContainer.style.width = '25%';
    boxContainer.style.height = newWidth + "px";
    // Hide tools section.
    toolsBar.style.display = 'none';
    // Change chat input placeholder.
    chatInput.placeholder = "Type:";
    redrawStrokes();
  } else {
    isKeyboardActive = false;
    gameContainer.style.flexDirection = 'column';
    canvasContainer.style.width = '100%';
    toolsBar.style.display = 'flex';
    resizeLayout();
    boxContainer.style.width = '100%';
    chatInput.placeholder = "Type your message...";
  }
}

function resizeLayout() {
  if (isKeyboardActive) return;
  const gameContainer = document.getElementById('gameContainer');
  const boxContainer = document.getElementById('boxContainer');
  const canvasContainer = document.getElementById('canvasContainer');
  const toolsBar = document.getElementById('toolsBar');

  const width = gameContainer.clientWidth;
  canvas.width = width;
  canvas.height = width;
  canvasContainer.style.height = width + "px";

  const toolsHeight = toolsBar ? toolsBar.offsetHeight : 0;
  const totalHeight = gameContainer.clientHeight;
  const boxHeight = totalHeight - width - toolsHeight;
  boxContainer.style.height = boxHeight + "px";

  redrawStrokes();
  updateDashHint();
}

window.addEventListener('resize', () => { if (!isKeyboardActive) resizeLayout(); });
window.addEventListener('orientationchange', () => { if (!isKeyboardActive) resizeLayout(); });
document.addEventListener('DOMContentLoaded', () => {
  resizeLayout();
  chatBox.scrollTop = chatBox.scrollHeight;
});

// --- Chat and Player Box ---
const toggleBoxBtn = document.getElementById('toggleBox');
const chatBox = document.getElementById('chatBox');
const playerBox = document.getElementById('playerBox');

toggleBoxBtn.addEventListener('click', () => {
  if (isChatView) {
    chatBox.style.display = 'none';
    playerBox.style.display = 'block';
  } else {
    chatBox.style.display = 'block';
    playerBox.style.display = 'none';
  }
  isChatView = !isChatView;
});

const chatInput = document.getElementById('chatInput');

chatInput.addEventListener('keydown', (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
      socket.emit('chatMessage', msg);
      chatInput.value = '';
    }
  }
});

chatInput.addEventListener('focus', () => { adjustLayoutForKeyboard(true); });
chatInput.addEventListener('blur', () => { adjustLayoutForKeyboard(false); });

function addChatMessage(data) {
  const p = document.createElement('p');
  // Use a slightly reduced font size and add a bottom margin for a one-line gap.
  p.style.fontSize = "14px";
  p.style.marginBottom = "1em";
  if (data.nickname && data.nickname.trim() !== "") {
    p.textContent = `${data.nickname}: ${data.message}`;
  } else {
    p.textContent = data.message;
  }
  // Insert new message at the top.
  if (chatBox.firstChild) {
    chatBox.insertBefore(p, chatBox.firstChild);
  } else {
    chatBox.appendChild(p);
  }
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
// For one-word objects, the dash hints are constructed as before (but font size is reduced via CSS).
// For two-word objects, join the hints with a " --- " gap.
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
    // Join the two hints with a gap of three dashes.
    hintWords.push(disp1.trim());
    hintWords.push(disp2.trim());
  }
  if (hintWords.length === 2) {
    dashHintDiv.textContent = hintWords.join(" --- ");
  } else {
    dashHintDiv.textContent = hintWords.join(" ");
  }
}

// --- Socket events ---

socket.on('init', (data) => {
  updatePlayerList(data.players);
  if (data.canvasStrokes) {
    paths = data.canvasStrokes;
    redrawStrokes();
  }
  if (data.decisionTimeLeft !== null && data.currentDrawer) {
    turnPrompt.style.display = 'flex';
    promptText.textContent = `${data.currentDrawerName} IS CHOOSING A WORD...`;
    turnOptionsDiv.innerHTML = "";
    countdownDisplay.textContent = data.decisionTimeLeft;
  }
  // Store the drawer’s name globally
  globalDrawerName = data.currentDrawerName || "";
});

socket.on('chatMessage', (data) => { addChatMessage(data); });
socket.on('updatePlayers', (playersArr) => { updatePlayerList(playersArr); });

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

socket.on('undo', () => { undoLastStroke(); });

// Turn and object selection events
const turnPrompt = document.getElementById('turnPrompt');
const promptText = document.getElementById('promptText');
const turnOptionsDiv = document.getElementById('turnOptions');
const countdownDisplay = document.getElementById('countdownDisplay');

socket.on('turnStarted', (data) => {
  globalDrawerName = data.currentDrawerName; // update global drawer name
  if (data.currentDrawer === socket.id) {
    isMyTurn = true;
    dashHintDiv.textContent = "";
    turnPrompt.style.display = 'flex';
    if (currentObjectStr) {
      objectDisplayElem.style.display = 'block';
      objectDisplayElem.textContent = currentObjectStr;
      objectDisplayElem.style.fontSize = "14px";
    }
  } else {
    isMyTurn = false;
    turnPrompt.style.display = 'flex';
    promptText.textContent = `${data.currentDrawerName} IS CHOOSING A WORD...`;
    turnOptionsDiv.innerHTML = "";
    objectDisplayElem.style.display = 'none';
    objectDisplayElem.textContent = '';
  }
  drawControlsDiv.style.display = 'block';
  if (data.currentDrawer === socket.id) {
    document.getElementById('undoBtn').style.display = 'inline-block';
    document.getElementById('clearBtn').style.display = 'inline-block';
    document.getElementById('giveUpBtn').style.display = 'inline-block';
  } else {
    document.getElementById('undoBtn').style.display = 'none';
    document.getElementById('clearBtn').style.display = 'none';
    document.getElementById('giveUpBtn').style.display = 'none';
  }
});

socket.on('turnCountdown', (timeLeft) => {
  if (turnPrompt.style.display !== 'none') {
    countdownDisplay.textContent = timeLeft;
  }
});

socket.on('turnTimeout', () => {
  turnPrompt.style.display = 'none';
  isMyTurn = false;
  objectDisplayElem.style.display = 'none';
  objectDisplayElem.textContent = '';
});

socket.on('objectSelection', (data) => {
  if (data.options && data.options.length > 0) {
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

socket.on('objectChosenBroadcast', (data) => {
  currentObjectStr = data.object;
  currentDrawTime = DRAW_DURATION;
  updateDashHint();
  if (isMyTurn) {
    objectDisplayElem.style.display = 'block';
    objectDisplayElem.textContent = data.object;
    objectDisplayElem.style.fontSize = "14px";
  }
});

// Updated drawPhaseStarted event to set a timer that clears dash hints and object display after 70 seconds,
// and then posts a system message (e.g., "ROCKY IS DRAWING BOTTLE").
socket.on('drawPhaseStarted', (data) => {
  if (data.currentDrawer === socket.id) {
    isMyTurn = true;
    turnPrompt.style.display = 'none';
    drawCountdown.style.display = 'block';
    drawCountdown.textContent = data.duration;
    dashHintDiv.textContent = "";
    drawControlsDiv.style.display = 'block';
    document.getElementById('undoBtn').style.display = 'inline-block';
    document.getElementById('clearBtn').style.display = 'inline-block';
    document.getElementById('giveUpBtn').style.display = 'inline-block';
    if (currentObjectStr) {
      objectDisplayElem.style.display = 'block';
      objectDisplayElem.textContent = currentObjectStr;
      objectDisplayElem.style.fontSize = "14px";
      if (drawPhaseObjectTimer) clearTimeout(drawPhaseObjectTimer);
      drawPhaseObjectTimer = setTimeout(() => {
        objectDisplayElem.style.display = 'none';
        objectDisplayElem.textContent = '';
        dashHintDiv.textContent = '';
        addChatMessage({nickname:"", message: `${globalDrawerName} IS DRAWING ${currentObjectStr.toUpperCase()}`});
      }, 70000);
    }
  } else {
    isMyTurn = false;
    turnPrompt.style.display = 'none';
    drawCountdown.style.display = 'block';
    drawCountdown.textContent = data.duration;
    drawControlsDiv.style.display = 'block';
    document.getElementById('undoBtn').style.display = 'none';
    document.getElementById('clearBtn').style.display = 'none';
    document.getElementById('giveUpBtn').style.display = 'none';
    objectDisplayElem.style.display = 'none';
    objectDisplayElem.textContent = '';
    if (drawPhaseObjectTimer) clearTimeout(drawPhaseObjectTimer);
    drawPhaseObjectTimer = setTimeout(() => {
      dashHintDiv.textContent = '';
      addChatMessage({nickname:"", message: `${globalDrawerName} IS DRAWING ${currentObjectStr.toUpperCase()}`});
    }, 70000);
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
  objectDisplayElem.style.display = 'none';
  objectDisplayElem.textContent = '';
  if (drawPhaseObjectTimer) clearTimeout(drawPhaseObjectTimer);
});

// --- Change Game Dropdown functionality ---
const changeGameBtn = document.getElementById('changeGameBtn');
const changeGameDropdown = document.getElementById('changeGameDropdown');

changeGameBtn.addEventListener('click', () => {
  if (changeGameDropdown.style.display === 'none' || changeGameDropdown.style.display === '') {
    fetch('/clusters')
      .then(res => res.json())
      .then(clusters => {
        changeGameDropdown.innerHTML = '';
        clusters.forEach(cluster => {
          let btn = document.createElement('button');
          btn.textContent = cluster;
          btn.style.width = '100%';
          btn.style.padding = '8px';
          btn.style.border = 'none';
          btn.style.background = 'none';
          btn.style.textAlign = 'left';
          btn.addEventListener('click', () => {
            if (cluster === currentCluster) {
              changeGameDropdown.style.display = 'none';
              return;
            }
            socket.emit('changeGameRequest', { newCluster: cluster });
            changeGameDropdown.style.display = 'none';
          });
          changeGameDropdown.appendChild(btn);
        });
        changeGameDropdown.style.display = 'block';
      });
  } else {
    changeGameDropdown.style.display = 'none';
  }
});

socket.on('gameChanged', (data) => {
  currentCluster = data.newCluster;
  turnPrompt.style.display = 'none';
  drawCountdown.style.display = 'none';
  objectDisplayElem.style.display = 'none';
});

socket.on('canvasMessage', (data) => {
  const canvasMessageElem = document.getElementById('canvasMessage');
  canvasMessageElem.textContent = data.message;
  canvasMessageElem.style.display = 'block';
  setTimeout(() => {
    canvasMessageElem.style.display = 'none';
  }, data.duration);
});

function getNormalizedPos(e) {
  const rect = canvas.getBoundingClientRect();
  let x, y;
  if (e.touches && e.touches.length > 0) {
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
  if (isDrawing) {
    let stroke = { path: currentPath, color: currentColor, thickness: currentThickness };
    paths.push(stroke);
    socket.emit('strokeComplete', stroke);
    redrawStrokes();
  }
  isDrawing = false;
}

// Mouse events
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', drawingMove);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Touch events
canvas.addEventListener('touchstart', (e) => { startDrawing(e); });
canvas.addEventListener('touchmove', (e) => { drawingMove(e); e.preventDefault(); });
canvas.addEventListener('touchend', (e) => { stopDrawing(e); });

// Updated drawStroke function to handle taps (single-point strokes)
function drawStroke(data, emitLocal) {
  if (!data.path || data.path.length === 0) return;
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (data.path.length === 1) {
    const pt = data.path[0];
    const x = pt.x * canvas.width;
    const y = pt.y * canvas.height;
    const radius = data.thickness / 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = data.color;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(data.path[0].x * canvas.width, data.path[0].y * canvas.height);
    for (let i = 1; i < data.path.length - 1; i++) {
      const x_i = data.path[i].x * canvas.width;
      const y_i = data.path[i].y * canvas.height;
      const x_next = data.path[i + 1].x * canvas.width;
      const y_next = data.path[i + 1].y * canvas.height;
      const midX = (x_i + x_next) / 2;
      const midY = (y_i + y_next) / 2;
      ctx.quadraticCurveTo(x_i, y_i, midX, midY);
    }
    let lastPoint = data.path[data.path.length - 1];
    ctx.lineTo(lastPoint.x * canvas.width, lastPoint.y * canvas.height);
    ctx.stroke();
  }
}

function undoLastStroke() {
  paths.pop();
  redrawStrokes();
}

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

// Updated undo button: only emit the undo event without calling undoLastStroke locally.
document.getElementById('undoBtn').addEventListener('click', () => {
  if (isMyTurn) {
    socket.emit('undo');
  }
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (isMyTurn) {
    socket.emit('clear');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paths = [];
    currentRemoteStroke = null;
  }
});
document.getElementById('giveUpBtn').addEventListener('click', () => {
  if (isMyTurn) {
    socket.emit('giveUp');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paths = [];
    currentRemoteStroke = null;
    isMyTurn = false;
    drawCountdown.style.display = 'none';
    dashHintDiv.textContent = "";
    objectDisplayElem.style.display = 'none';
    objectDisplayElem.textContent = '';
    if (drawPhaseObjectTimer) clearTimeout(drawPhaseObjectTimer);
  }
});

chatInput.addEventListener('focus', () => { adjustLayoutForKeyboard(true); });
chatInput.addEventListener('blur', () => { adjustLayoutForKeyboard(false); });
