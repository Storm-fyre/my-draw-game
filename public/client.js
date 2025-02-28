// client.js
const socket = io();

// UI references
let nicknamePrompt, nicknameInput, joinBtn;
let gameContainer;
let turnInfo, countdownBar, countdownFill, countdownNumber;
let decisionButtons, drawBtn, skipBtn;
let drawingTools, undoBtn, clearBtn;
let myCanvas, ctx;
let chatBox, chatInput, chatSendBtn;
let playersList;

// State
let username = null;
let amICurrentDrawer = false;
let isDecisionPhase = false;
let isDrawingPhase = false;

// For partial drawing
let drawing = false;
let pathPoints = [];  // Store all points for final stroke
let lastX, lastY;

// For final strokes
let strokes = []; // { strokeId, path, color, drawerId }
let countdownInterval = null;

window.addEventListener('load', () => {
  // DOM elements
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
  undoBtn = document.getElementById('undoBtn');
  clearBtn = document.getElementById('clearBtn');

  myCanvas = document.getElementById('myCanvas');
  ctx = myCanvas.getContext('2d');

  chatBox = document.getElementById('chatBox');
  chatInput = document.getElementById('chatInput');
  chatSendBtn = document.getElementById('chatSendBtn');

  playersList = document.getElementById('playersList');

  // 1) Hide the main game container, show only after nickname
  gameContainer.style.display = 'none';

  // Join game on button click
  joinBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (name) {
      username = name;
      socket.emit('joinGame', username);

      // Hide the prompt, show the game
      nicknamePrompt.style.display = 'none';
      gameContainer.style.display = 'flex';
    }
  });

  // Decision
  drawBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'draw');
  });
  skipBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'skip');
  });

  // Drawing tools
  undoBtn.addEventListener('click', () => {
    socket.emit('undoStroke');
  });
  clearBtn.addEventListener('click', () => {
    socket.emit('clearCanvas');
  });

  // Canvas events for real-time drawing
  myCanvas.addEventListener('mousedown', (e) => {
    if (!amICurrentDrawer || !isDrawingPhase) return;
    drawing = true;
    pathPoints = []; // reset
    const { x, y } = getCanvasCoords(e);
    lastX = x;
    lastY = y;
    pathPoints.push({ x, y });
  });

  myCanvas.addEventListener('mousemove', (e) => {
    if (!amICurrentDrawer || !isDrawingPhase || !drawing) return;

    const { x, y } = getCanvasCoords(e);

    // Send partial line segment from (lastX,lastY) to (x,y)
    socket.emit('partialDrawing', {
      fromX: lastX,
      fromY: lastY,
      toX: x,
      toY: y,
      color: 'local' // will be replaced by server with actual color if needed
    });

    // Also draw it locally
    drawSegment(lastX, lastY, x, y, 'rgba(0,0,0,0.4)');

    pathPoints.push({ x, y });
    lastX = x;
    lastY = y;
  });

  myCanvas.addEventListener('mouseup', () => {
    if (drawing) {
      drawing = false;
      // Send the complete path for server storage (undo/clear)
      socket.emit('strokeComplete', pathPoints);
    }
  });

  myCanvas.addEventListener('mouseleave', () => {
    if (drawing) {
      drawing = false;
      socket.emit('strokeComplete', pathPoints);
    }
  });

  // Chat
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

  // Initial strokes & chat
  socket.on('initCanvas', (allStrokes) => {
    strokes = allStrokes;
    redrawCanvas();
  });
  socket.on('initChat', (messages) => {
    chatBox.innerHTML = '';
    messages.forEach((msg) => appendChat(msg.username, msg.text));
  });

  // Partial real-time drawing from others
  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color }) => {
    // color is determined on the server side if needed, but
    // we can just draw it in a semitransparent style
    drawSegment(fromX, fromY, toX, toY, 'rgba(0,0,0,0.4)');
  });

  // Final stroke completed by someone (including me, but I'll have it already)
  socket.on('strokeComplete', (stroke) => {
    strokes.push(stroke);
    drawStroke(stroke);
  });

  // Remove stroke (undo)
  socket.on('removeStroke', (strokeId) => {
    const idx = strokes.findIndex(s => s.strokeId === strokeId);
    if (idx !== -1) {
      strokes.splice(idx, 1);
      redrawCanvas();
    }
  });

  // Clear
  socket.on('clearCanvas', () => {
    strokes = [];
    redrawCanvas();
  });

  // Chat
  socket.on('chatMessage', (msg) => {
    appendChat(msg.username, msg.text);
  });

  // Turn info
  socket.on('turnInfo', (data) => {
    const { currentPlayerId, currentPlayerName, isDrawingPhase: drawingPhase, timeLeft } = data;
    amICurrentDrawer = (socket.id === currentPlayerId);
    isDecisionPhase = !drawingPhase;
    isDrawingPhase = drawingPhase;

    // Stop old countdown
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

  // Players list
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

  /* ======================= HELPER FUNCTIONS ======================= */

  function getCanvasCoords(e) {
    const rect = myCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function drawSegment(x1, y1, x2, y2, strokeStyle) {
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawStroke(stroke) {
    const { path, color } = stroke;
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color || 'black';
    ctx.lineWidth = 3;
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

  // Countdown
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
