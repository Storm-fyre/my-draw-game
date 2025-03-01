// client.js
const socket = io();

// DOM references
let nicknamePrompt, nicknameInput, joinBtn;
let gameContainer;
let turnInfo, countdownBar, countdownFill, countdownNumber;
let decisionButtons, drawBtn, skipBtn;
let drawingTools, colorSelect, thicknessSelect, undoBtn, clearBtn, giveUpBtn;
let myCanvas, ctx;
let chatBox, chatInput, chatSendBtn;
let playersList;

// State
let username = null;
let amICurrentDrawer = false;
let isDecisionPhase = false;
let isDrawingPhase = false;

// Toolbox settings
let currentColor = '#000000';
let currentThickness = 1;

// For partial drawing
let drawing = false;
let pathPoints = [];
let lastX, lastY;

// Strokes from server for re-draw
let strokes = [];
let countdownInterval = null;

// Chat messages (store up to 20 on client)
let localMessages = [];

window.addEventListener('load', () => {
  nicknamePrompt = document.getElementById('nicknamePrompt');
  nicknameInput = document.getElementById('nicknameInput');
  joinBtn = document.getElementById('joinBtn');

  gameContainer = document.getElementById('gameContainer');
  turnInfo = document.getElementById('turnInfo');
  countdownBar = document.getElementById('countdownBar');
  countdownFill = document.getElementById('countdownFill');
  countdownNumber = document.getElementById('countdownNumber');

  decisionButtons = document.getElementById('decisionButtons');
  drawBtn = document.getElementById('drawBtn');
  skipBtn = document.getElementById('skipBtn');

  drawingTools = document.getElementById('drawingTools');
  colorSelect = document.getElementById('colorSelect');
  thicknessSelect = document.getElementById('thicknessSelect');
  undoBtn = document.getElementById('undoBtn');
  clearBtn = document.getElementById('clearBtn');
  giveUpBtn = document.getElementById('giveUpBtn');

  myCanvas = document.getElementById('myCanvas');
  ctx = myCanvas.getContext('2d');

  chatBox = document.getElementById('chatBox');
  chatInput = document.getElementById('chatInput');
  chatSendBtn = document.getElementById('chatSendBtn');

  playersList = document.getElementById('playersList');

  // Hide main container initially
  gameContainer.style.display = 'none';

  // Join game
  joinBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (name) {
      username = name;
      socket.emit('joinGame', username);

      nicknamePrompt.style.display = 'none';
      gameContainer.style.display = 'block';

      // Update orientation layout once joined
      updateLayout();
    }
  });

  // Decision
  drawBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'draw');
  });
  skipBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'skip');
  });

  // Toolbox changes
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

  // Drawing: Mouse
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

  // Drawing: Touch
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

  // Chat
  chatSendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    }
  });

  // Detect focus/blur on chat input => "typing mode" (portrait only)
  chatInput.addEventListener('focus', () => {
    // If we are in portrait, set body.typing-mode
    if (isPortrait()) {
      document.body.classList.add('typing-mode');
      updateLayout();
    }
  });
  chatInput.addEventListener('blur', () => {
    // Remove typing mode
    document.body.classList.remove('typing-mode');
    updateLayout();
  });

  // Listen for window resize to handle orientation changes
  window.addEventListener('resize', () => {
    updateLayout();
  });

  /***********************************************
   * SOCKET EVENTS
   ***********************************************/
  socket.on('initCanvas', (allStrokes) => {
    strokes = allStrokes;
    redrawCanvas();
  });

  socket.on('initChat', (messages) => {
    localMessages = messages.slice(-20); // store up to 20
    renderChatMessages();
  });

  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color, thickness }) => {
    drawSegment(fromX, fromY, toX, toY, color || '#000', thickness || 1, 0.4);
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
    // Only keep last 20 locally
    localMessages.push(msg);
    if (localMessages.length > 20) {
      localMessages.shift();
    }
    renderChatMessages();
  });

  socket.on('turnInfo', (data) => {
    const { currentPlayerId, currentPlayerName, isDrawingPhase: drawingPhase, timeLeft } = data;
    amICurrentDrawer = (socket.id === currentPlayerId);
    isDecisionPhase = !drawingPhase;
    isDrawingPhase = drawingPhase;

    stopCountdown();

    if (amICurrentDrawer && isDecisionPhase) {
      turnInfo.textContent = "It's your turn! Decide if you want to draw.";
      decisionButtons.style.display = 'flex';
      drawingTools.style.display = 'none';
      startCountdown(timeLeft, (remaining) => {
        turnInfo.textContent = `You have ${remaining}s to choose: Draw or Skip`;
      });
    } else if (amICurrentDrawer && isDrawingPhase) {
      turnInfo.textContent = 'You are drawing now!';
      decisionButtons.style.display = 'none';
      drawingTools.style.display = 'flex';
      startCountdown(timeLeft, (remaining) => {
        turnInfo.textContent = `Drawing! ${remaining}s left...`;
      });
    } else {
      // Another player's turn
      decisionButtons.style.display = 'none';
      drawingTools.style.display = 'none';

      if (isDecisionPhase) {
        turnInfo.textContent = `${currentPlayerName} is deciding...`;
      } else {
        turnInfo.textContent = `${currentPlayerName} is drawing...`;
      }
      startCountdown(timeLeft, (remaining) => {
        if (isDecisionPhase) {
          turnInfo.textContent = `${currentPlayerName} is deciding... ${remaining}s left`;
        } else {
          turnInfo.textContent = `${currentPlayerName} is drawing... ${remaining}s left`;
        }
      });
    }
  });

  socket.on('playersList', (players) => {
    playersList.innerHTML = '';
    players.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'player-item';

      const swatch = document.createElement('div');
      swatch.className = 'player-color-swatch';
      swatch.style.backgroundColor = p.color;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.username;

      div.appendChild(swatch);
      div.appendChild(nameSpan);
      playersList.appendChild(div);
    });
  });

  /***********************************************
   * HELPER FUNCTIONS
   ***********************************************/
  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text && username) {
      socket.emit('chatMessage', text);
      chatInput.value = '';
    }
  }

  function isPortrait() {
    return window.innerHeight >= window.innerWidth;
  }

  function updateLayout() {
    // Add either .portrait or .landscape to #gameContainer
    if (isPortrait()) {
      gameContainer.classList.add('portrait');
      gameContainer.classList.remove('landscape');
    } else {
      gameContainer.classList.add('landscape');
      gameContainer.classList.remove('portrait');
      // In landscape, we remove typing-mode
      document.body.classList.remove('typing-mode');
    }
  }

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

  function getCanvasCoords(clientX, clientY) {
    const rect = myCanvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function drawSegment(x1, y1, x2, y2, strokeStyle, thickness, alpha=1.0) {
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
    ctx.strokeStyle = color || '#000';
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

  function renderChatMessages() {
    // We have localMessages (up to 20).
    chatBox.innerHTML = '';
    localMessages.forEach(msg => {
      const div = document.createElement('div');
      div.textContent = `${msg.username}: ${msg.text}`;
      chatBox.appendChild(div);
    });
    // Scroll to bottom to see the latest
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function startCountdown(total, onTick) {
    countdownBar.style.display = 'block';
    countdownNumber.style.display = 'block';

    let secondsLeft = total;
    updateCountdownBar(1);
    updateCountdownNumber(secondsLeft);

    onTick && onTick(secondsLeft);

    countdownInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft < 0) {
        stopCountdown();
      } else {
        onTick && onTick(secondsLeft);
        const progress = secondsLeft / total;
        updateCountdownBar(progress);
        updateCountdownNumber(secondsLeft);
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
    countdownBar.style.display = 'none';
    countdownNumber.style.display = 'none';
  }

  function updateCountdownBar(progress) {
    countdownFill.style.width = (progress * 100) + '%';
  }

  function updateCountdownNumber(num) {
    countdownNumber.textContent = num + 's';
  }
});
