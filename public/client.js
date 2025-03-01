const socket = io();

// DOM Elements
let nicknamePrompt, nicknameInput, joinBtn;
let gameContainer;
let turnInfo, countdownBar, countdownFill, countdownNumber;
let decisionButtons, drawBtn, skipBtn;
let drawingTools, colorSelect, thicknessSelect, undoBtn, clearBtn, giveUpBtn;
let myCanvas, ctx;
let chatBox, chatInput, chatSendBtn;
let playersList;

// State variables
let username = null;
let amICurrentDrawer = false;
let isDecisionPhase = false;
let isDrawingPhase = false;

// Toolbox settings
let currentColor = '#000000';
let currentThickness = 1;

// For partial drawing
let drawing = false;
let pathPoints = [];  // array of {x,y}
let lastX, lastY;

// Strokes from server for re-draw
let strokes = [];
let countdownInterval = null;

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

  // Adjust canvas internal resolution to match its displayed size
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
      // Ensure canvas is correctly sized when game starts
      adjustCanvasSize();
    }
  });

  // Adjust layout when the chat input is focused (typing mode)
  chatInput.addEventListener('focus', () => {
    gameContainer.classList.add('typing');
  });
  chatInput.addEventListener('blur', () => {
    gameContainer.classList.remove('typing');
  });

  // Decision buttons
  drawBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'draw');
  });
  skipBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'skip');
  });

  // Toolbox settings
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

    // Emit partial drawing segment
    socket.emit('partialDrawing', {
      fromX: lastX, fromY: lastY, toX: x, toY: y,
      color: currentColor,
      thickness: currentThickness
    });

    // Draw segment locally with partial opacity
    drawSegment(lastX, lastY, x, y, currentColor, currentThickness, 0.4);

    pathPoints.push({ x, y });
    lastX = x;
    lastY = y;
  }
  function endDrawing() {
    drawing = false;
    // Emit the final stroke
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
    // Draw partial segment from another user
    drawSegment(fromX, fromY, toX, toY, color || 'black', thickness || 1, 0.4);
  });

  socket.on('strokeComplete', (stroke) => {
    // Stroke format: { strokeId, path, color, thickness, drawerId }
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

  // Chat messages from server
  socket.on('chatMessage', (msg) => {
    appendChat(msg.username, msg.text);
  });

  // Turn info updates
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
      // Other player's turn
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

  // Update players list
  socket.on('playersList', (players) => {
    playersList.innerHTML = '';
    players.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'player-item';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.margin = '4px 0';

      const swatch = document.createElement('div');
      swatch.className = 'player-color-swatch';
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
      playersList.appendChild(div);
    });
  });

  /* ======================= HELPER FUNCTIONS ======================= */

  function getCanvasCoords(clientX, clientY) {
    const rect = myCanvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  // Draw a segment with optional alpha for partial strokes
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

  // Countdown timer functions
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
