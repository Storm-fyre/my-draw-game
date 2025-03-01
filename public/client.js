const socket = io();

// DOM Elements
let nicknamePrompt = document.getElementById('nicknamePrompt');
let nicknameInput = document.getElementById('nicknameInput');
let joinBtn = document.getElementById('joinBtn');

let gameContainer = document.getElementById('gameContainer');
let canvasSection = document.getElementById('canvasSection');
let canvasWrapper = document.getElementById('canvasWrapper');
let myCanvas = document.getElementById('myCanvas');
let countdownOverlay = document.getElementById('countdownOverlay');

let decisionButtons = document.getElementById('decisionButtons');
let drawBtn = document.getElementById('drawBtn');
let skipBtn = document.getElementById('skipBtn');

let drawingTools = document.getElementById('drawingTools');
let colorSelect = document.getElementById('colorSelect');
let thicknessSelect = document.getElementById('thicknessSelect');
let undoBtn = document.getElementById('undoBtn');
let clearBtn = document.getElementById('clearBtn');
let giveUpBtn = document.getElementById('giveUpBtn');

let toggleBtn = document.getElementById('toggleBtn');
let contentHeader = document.getElementById('contentHeader');
let contentArea = document.getElementById('contentArea');
let chatBox = document.getElementById('chatBox');
let playersBox = document.getElementById('playersBox');

let inputSection = document.getElementById('inputSection');
let chatInput = document.getElementById('chatInput');
let chatSendBtn = document.getElementById('chatSendBtn');

let ctx = myCanvas.getContext('2d');

// State variables
let username = null;
let amICurrentDrawer = false;
let isDecisionPhase = false;
let isDrawingPhase = false;

let currentColor = '#000000';
let currentThickness = 1;

// Drawing state
let drawing = false;
let pathPoints = [];
let lastX, lastY;

// Strokes storage
let strokes = [];
let countdownInterval = null;

// Adjust canvas dimensions to ensure the internal coordinate system matches its displayed size
function adjustCanvasSize() {
  // Use the canvasWrapper dimensions
  myCanvas.width = canvasWrapper.clientWidth;
  myCanvas.height = canvasWrapper.clientHeight;
  redrawCanvas();
}

// Dynamically adjust layout based on available space
function adjustLayout() {
  adjustCanvasSize();
  // In non-typing mode, gameContainer is vertical.
  // In typing mode, a "typing" class is added which changes the layout.
  // No additional JS is needed as CSS flex rules will apply.
}

window.addEventListener('resize', adjustLayout);

// Nickname join
joinBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if (name) {
    username = name;
    socket.emit('joinGame', username);
    nicknamePrompt.style.display = 'none';
    gameContainer.style.display = 'flex';
    adjustLayout();
  }
});

// Toggle between Chat and Players view
toggleBtn.addEventListener('click', () => {
  if (chatBox.style.display !== 'none') {
    // Show Players
    chatBox.style.display = 'none';
    playersBox.style.display = 'block';
    contentHeader.textContent = 'Player Box';
    toggleBtn.textContent = 'Show Messages';
  } else {
    // Show Chat
    chatBox.style.display = 'block';
    playersBox.style.display = 'none';
    contentHeader.textContent = 'Message Box';
    toggleBtn.textContent = 'Show Players';
  }
});

// Typing mode: add or remove class to adjust layout
chatInput.addEventListener('focus', () => {
  gameContainer.classList.add('typing');
  adjustLayout();
});
chatInput.addEventListener('blur', () => {
  gameContainer.classList.remove('typing');
  adjustLayout();
});

// Decision and drawing tool buttons
drawBtn.addEventListener('click', () => { socket.emit('drawChoice', 'draw'); });
skipBtn.addEventListener('click', () => { socket.emit('drawChoice', 'skip'); });

colorSelect.addEventListener('change', (e) => { currentColor = e.target.value; });
thicknessSelect.addEventListener('change', (e) => { currentThickness = parseInt(e.target.value, 10); });
undoBtn.addEventListener('click', () => { socket.emit('undoStroke'); });
clearBtn.addEventListener('click', () => { socket.emit('clearCanvas'); });
giveUpBtn.addEventListener('click', () => { socket.emit('giveUp'); });

// Drawing events (mouse and touch)
myCanvas.addEventListener('mousedown', (e) => {
  if (!amICurrentDrawer || !isDrawingPhase) return;
  e.preventDefault();
  startDrawing(e.clientX, e.clientY);
});
myCanvas.addEventListener('mousemove', (e) => {
  if (!amICurrentDrawer || !isDrawingPhase || !drawing) return;
  e.preventDefault();
  moveDrawing(e.clientX, e.clientY);
});
myCanvas.addEventListener('mouseup', (e) => {
  if (drawing) { e.preventDefault(); endDrawing(); }
});
myCanvas.addEventListener('mouseleave', (e) => {
  if (drawing) { e.preventDefault(); endDrawing(); }
});
myCanvas.addEventListener('touchstart', (e) => {
  if (!amICurrentDrawer || !isDrawingPhase) return;
  e.preventDefault();
  const touch = e.touches[0];
  startDrawing(touch.clientX, touch.clientY);
}, { passive: false });
myCanvas.addEventListener('touchmove', (e) => {
  if (!amICurrentDrawer || !isDrawingPhase || !drawing) return;
  e.preventDefault();
  const touch = e.touches[0];
  moveDrawing(touch.clientX, touch.clientY);
}, { passive: false });
myCanvas.addEventListener('touchend', (e) => {
  if (drawing) { e.preventDefault(); endDrawing(); }
}, { passive: false });

function startDrawing(clientX, clientY) {
  drawing = true;
  pathPoints = [];
  let coords = getCanvasCoords(clientX, clientY);
  lastX = coords.x; lastY = coords.y;
  pathPoints.push({ x: lastX, y: lastY });
}
function moveDrawing(clientX, clientY) {
  let coords = getCanvasCoords(clientX, clientY);
  socket.emit('partialDrawing', {
    fromX: lastX, fromY: lastY,
    toX: coords.x, toY: coords.y,
    color: currentColor,
    thickness: currentThickness
  });
  drawSegment(lastX, lastY, coords.x, coords.y, currentColor, currentThickness, 0.4);
  pathPoints.push({ x: coords.x, y: coords.y });
  lastX = coords.x; lastY = coords.y;
}
function endDrawing() {
  drawing = false;
  socket.emit('strokeComplete', {
    path: pathPoints,
    color: currentColor,
    thickness: currentThickness
  });
}

// Chat message sending
chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (text && username) {
    socket.emit('chatMessage', text);
    chatInput.value = '';
  }
}

// Socket Events
socket.on('initCanvas', (allStrokes) => { strokes = allStrokes; redrawCanvas(); });
socket.on('initChat', (messages) => {
  chatBox.innerHTML = '';
  messages.forEach(msg => appendChat(msg.username, msg.text));
});
socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color, thickness }) => {
  drawSegment(fromX, fromY, toX, toY, color || 'black', thickness || 1, 0.4);
});
socket.on('strokeComplete', (stroke) => { strokes.push(stroke); drawStroke(stroke); });
socket.on('removeStroke', (strokeId) => {
  const idx = strokes.findIndex(s => s.strokeId === strokeId);
  if (idx !== -1) { strokes.splice(idx, 1); redrawCanvas(); }
});
socket.on('clearCanvas', () => { strokes = []; redrawCanvas(); });
socket.on('chatMessage', (msg) => { appendChat(msg.username, msg.text); });
socket.on('playersList', (players) => {
  playersBox.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.margin = '4px 0';
    const swatch = document.createElement('div');
    swatch.style.width = '16px';
    swatch.style.height = '16px';
    swatch.style.borderRadius = '3px';
    swatch.style.marginRight = '6px';
    swatch.style.border = '1px solid #333';
    swatch.style.backgroundColor = p.color;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.username;
    div.appendChild(swatch);
    div.appendChild(nameSpan);
    playersBox.appendChild(div);
  });
});
socket.on('turnInfo', (data) => {
  const { currentPlayerId, currentPlayerName, isDrawingPhase: drawingPhase, timeLeft } = data;
  amICurrentDrawer = (socket.id === currentPlayerId);
  isDecisionPhase = !drawingPhase;
  isDrawingPhase = drawingPhase;
  
  stopCountdown();
  
  if (amICurrentDrawer && isDecisionPhase) {
    decisionButtons.style.display = 'block';
    drawingTools.style.display = 'none';
    countdownOverlay.style.display = 'block';
    countdownOverlay.textContent = timeLeft;
    startCountdown(timeLeft, (remaining) => { countdownOverlay.textContent = remaining; });
  } else if (amICurrentDrawer && isDrawingPhase) {
    decisionButtons.style.display = 'none';
    drawingTools.style.display = 'block';
    countdownOverlay.style.display = 'none';
    startCountdown(timeLeft, () => {});
  } else {
    decisionButtons.style.display = 'none';
    drawingTools.style.display = 'none';
    countdownOverlay.style.display = 'none';
    startCountdown(timeLeft, () => {});
  }
});

// Helper Functions
function getCanvasCoords(clientX, clientY) {
  const rect = myCanvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
function drawSegment(x1, y1, x2, y2, strokeStyle, thickness, alpha = 1.0) {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = thickness;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}
function drawStroke(stroke) {
  const { path, color, thickness } = stroke;
  if (!path || path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color || 'black';
  ctx.lineWidth = thickness || 1;
  ctx.globalAlpha = 1.0;
  ctx.beginPath();
  for (let i = 0; i < path.length - 1; i++) {
    ctx.moveTo(path[i].x, path[i].y);
    ctx.lineTo(path[i+1].x, path[i+1].y);
  }
  ctx.stroke();
  ctx.restore();
}
function redrawCanvas() {
  ctx.clearRect(0, 0, myCanvas.width, myCanvas.height);
  strokes.forEach(s => drawStroke(s));
}
function appendChat(user, text) {
  const div = document.createElement('div');
  div.textContent = `${user}: ${text}`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function startCountdown(total, onTick) {
  let secondsLeft = total;
  updateCountdown(secondsLeft);
  countdownInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft < 0) stopCountdown();
    else { onTick && onTick(secondsLeft); updateCountdown(secondsLeft); }
  }, 1000);
}
function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
}
function updateCountdown(num) {
  countdownOverlay.textContent = num + 's';
}
