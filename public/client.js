const socket = io();

// DOM Elements
let nicknamePrompt, nicknameInput, joinBtn;
let gameContainer;
let countdownOverlay;
let decisionButtons, drawBtn, skipBtn;
let drawingTools, colorSelect, thicknessSelect, undoBtn, clearBtn, giveUpBtn;
let toggleBtn;
let myCanvas, ctx;
let chatBox, playersBox, chatInput, chatSendBtn;

// State variables
let username = null;
let amICurrentDrawer = false;
let isDecisionPhase = false;
let isDrawingPhase = false;

// Toolbox settings
let currentColor = '#000000';
let currentThickness = 1;

// For drawing
let drawing = false;
let pathPoints = [];
let lastX, lastY;

// Strokes from server for re-draw
let strokes = [];
let countdownInterval = null;

window.addEventListener('load', () => {
  nicknamePrompt = document.getElementById('nicknamePrompt');
  nicknameInput = document.getElementById('nicknameInput');
  joinBtn = document.getElementById('joinBtn');

  gameContainer = document.getElementById('gameContainer');
  countdownOverlay = document.getElementById('countdownOverlay');

  decisionButtons = document.getElementById('decisionButtons');
  drawBtn = document.getElementById('drawBtn');
  skipBtn = document.getElementById('skipBtn');

  drawingTools = document.getElementById('drawingTools');
  colorSelect = document.getElementById('colorSelect');
  thicknessSelect = document.getElementById('thicknessSelect');
  undoBtn = document.getElementById('undoBtn');
  clearBtn = document.getElementById('clearBtn');
  giveUpBtn = document.getElementById('giveUpBtn');

  toggleBtn = document.getElementById('toggleBtn');

  myCanvas = document.getElementById('myCanvas');
  ctx = myCanvas.getContext('2d');

  chatBox = document.getElementById('chatBox');
  playersBox = document.getElementById('playersBox');
  chatInput = document.getElementById('chatInput');
  chatSendBtn = document.getElementById('chatSendBtn');

  // Hide main container initially
  gameContainer.style.display = 'none';

  // Adjust canvas size to match its container (so the internal coordinate system matches)
  function adjustCanvasSize() {
    const canvasWrapper = document.getElementById('canvasWrapper');
    myCanvas.width = canvasWrapper.clientWidth;
    myCanvas.height = canvasWrapper.clientHeight;
    redrawCanvas();
  }
  window.addEventListener('resize', adjustCanvasSize);
  adjustCanvasSize();

  // Nickname join
  joinBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (name) {
      username = name;
      socket.emit('joinGame', username);
      nicknamePrompt.style.display = 'none';
      gameContainer.style.display = 'flex';
      adjustCanvasSize();
    }
  });

  // Toggle between Chat and Players view in the bottom section
  toggleBtn.addEventListener('click', () => {
    if (chatBox.style.display !== 'none') {
      chatBox.style.display = 'none';
      playersBox.style.display = 'block';
      toggleBtn.textContent = 'Show Messages';
    } else {
      chatBox.style.display = 'block';
      playersBox.style.display = 'none';
      toggleBtn.textContent = 'Show Players';
    }
  });

  // Typing mode: adjust layout when chat input is focused
  chatInput.addEventListener('focus', () => {
    gameContainer.classList.add('typing');
    adjustCanvasSize();
  });
  chatInput.addEventListener('blur', () => {
    gameContainer.classList.remove('typing');
    adjustCanvasSize();
  });

  // Decision buttons
  drawBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'draw');
  });
  skipBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'skip');
  });

  // Drawing tools
  colorSelect.addEventListener('change', (e) => {
    currentColor = e.target.value;
  });
  thicknessSelect.addEventListener('change', (e) => {
    currentThickness = parseInt(e.target.value, 10);
  });
  undoBtn.addEventListener('click', () => {
    socket.emit('undoStroke');
  });
  clearBtn.addEventListener('click', () => {
    socket.emit('clearCanvas');
  });
  giveUpBtn.addEventListener('click', () => {
    socket.emit('giveUp');
  });

  // Mouse drawing events
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
    if (drawing) {
      e.preventDefault();
      endDrawing();
    }
  });
  myCanvas.addEventListener('mouseleave', (e) => {
    if (drawing) {
      e.preventDefault();
      endDrawing();
    }
  });

  // Touch drawing events
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
    if (drawing) {
      e.preventDefault();
      endDrawing();
    }
  }, { passive: false });

  function startDrawing(clientX, clientY) {
    drawing = true;
    pathPoints = [];
    const { x, y } = getCanvasCoords(clientX, clientY);
    lastX = x;
    lastY = y;
    pathPoints.push({ x, y });
  }
  function moveDrawing(clientX, clientY) {
    const { x, y } = getCanvasCoords(clientX, clientY);
    socket.emit('partialDrawing', {
      fromX: lastX, fromY: lastY, toX: x, toY: y,
      color: currentColor,
      thickness: currentThickness
    });
    drawSegment(lastX, lastY, x, y, currentColor, currentThickness, 0.4);
    pathPoints.push({ x, y });
    lastX = x;
    lastY = y;
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

  /* ======================== SOCKET EVENTS ======================== */
  
  socket.on('initCanvas', (allStrokes) => {
    strokes = allStrokes;
    redrawCanvas();
  });
  socket.on('initChat', (messages) => {
    chatBox.innerHTML = '';
    messages.forEach((msg) => appendChat(msg.username, msg.text));
  });
  
  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color, thickness }) => {
    drawSegment(fromX, fromY, toX, toY, color || 'black', thickness || 1, 0.4);
  });
  
  socket.on('strokeComplete', (stroke) => {
    strokes.push(stroke);
    drawStroke(stroke);
  });
  
  socket.on('removeStroke', (strokeId) => {
    const idx = strokes.findIndex(s => s.strokeId === strokeId);
    if (idx !== -1) {
      strokes.splice(idx, 1);
      redrawCanvas();
    }
  });
  
  socket.on('clearCanvas', () => {
    strokes = [];
    redrawCanvas();
  });
  
  socket.on('chatMessage', (msg) => {
    appendChat(msg.username, msg.text);
  });
  
  socket.on('playersList', (players) => {
    playersBox.innerHTML = '';
    players.forEach((p) => {
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
      startCountdown(timeLeft, (remaining) => {
        countdownOverlay.textContent = remaining;
      });
    } else if (amICurrentDrawer && isDrawingPhase) {
      decisionButtons.style.display = 'none';
      drawingTools.style.display = 'block';
      countdownOverlay.style.display = 'none';
      startCountdown(timeLeft, (remaining) => {
        // Optional: update if needed
      });
    } else {
      decisionButtons.style.display = 'none';
      drawingTools.style.display = 'none';
      countdownOverlay.style.display = 'none';
      startCountdown(timeLeft, (remaining) => {
        // Optional update for observers
      });
    }
  });
  
  /* ======================= HELPER FUNCTIONS ======================= */
  
  function getCanvasCoords(clientX, clientY) {
    const rect = myCanvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
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
      const p1 = path[i];
      const p2 = path[i + 1];
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
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
      if (secondsLeft < 0) {
        stopCountdown();
      } else {
        onTick && onTick(secondsLeft);
        updateCountdown(secondsLeft);
      }
    }, 1000);
  }
  
  function stopCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  function updateCountdown(num) {
    countdownOverlay.textContent = num + 's';
  }
});
