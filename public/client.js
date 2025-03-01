// client.js
const socket = io();

let nicknamePrompt, lobbyPrompt, gameContainer;
let nicknameInput, joinBtn;
let lobbySelect, lobbyPasscode, lobbyJoinBtn, lobbyError;
let turnInfo, countdownBar, countdownFill, countdownNumber;
let decisionButtons, drawBtn, skipBtn;
let drawingTools, colorSelect, thicknessSelect, undoBtn, clearBtn, giveUpBtn;
let myCanvas, ctx;
let chatBox, chatInput, chatSendBtn;
let chatBoxPortrait, chatInputPortrait, chatSendPortrait;
let playersList, playersListPortrait;
let bottomContainer;

let username = null;
let currentLobbyName = null;

// Toolbox color/thickness
let currentColor = '#000000';
let currentThickness = 1;

// Drawing state
let drawing = false;
let pathPoints = [];
let lastX, lastY;
let strokes = [];
let countdownInterval = null;
let amICurrentDrawer = false;
let isDrawingPhase = false;

window.addEventListener('load', () => {
  nicknamePrompt = document.getElementById('nicknamePrompt');
  lobbyPrompt = document.getElementById('lobbyPrompt');
  gameContainer = document.getElementById('gameContainer');

  nicknameInput = document.getElementById('nicknameInput');
  joinBtn = document.getElementById('joinBtn');

  lobbySelect = document.getElementById('lobbySelect');
  lobbyPasscode = document.getElementById('lobbyPasscode');
  lobbyJoinBtn = document.getElementById('lobbyJoinBtn');
  lobbyError = document.getElementById('lobbyError');

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

  // Portrait UI
  chatBoxPortrait = document.getElementById('chatBoxPortrait');
  chatInputPortrait = document.getElementById('chatInputPortrait');
  chatSendPortrait = document.getElementById('chatSendPortrait');
  playersList = document.getElementById('playersList');
  playersListPortrait = document.getElementById('playersListPortrait');
  bottomContainer = document.getElementById('bottomContainer');

  // Step 1: Show nickname prompt
  nicknamePrompt.style.display = 'flex';

  // After nickname, show lobby prompt
  joinBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (!name) return;
    username = name;

    nicknamePrompt.style.display = 'none';
    lobbyPrompt.style.display = 'flex';

    // Hardcode the lobbies or fetch from server if you want
    // For simplicity, let's just match what's in lobbies.js
    const lobbies = [
      { name: 'fun-room' },
      { name: 'secret-room' },
      { name: 'vip-room' }
    ];
    lobbySelect.innerHTML = '';
    lobbies.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.name;
      opt.textContent = l.name;
      lobbySelect.appendChild(opt);
    });
  });

  // Step 2: Choose lobby + passcode
  lobbyJoinBtn.addEventListener('click', () => {
    const lobbyName = lobbySelect.value;
    const passcode = lobbyPasscode.value.trim();
    if (!lobbyName || !passcode) return;

    socket.emit('joinLobby', { lobbyName, passcode, username });
  });

  // If pass/fail, server may respond with "lobbyError"
  socket.on('lobbyError', (msg) => {
    lobbyError.textContent = msg;
  });

  // If join was successful, we proceed once we get data from the server
  // We'll rely on the "initCanvas" event (or so) to finalize switching to game view

  /* ==================== Tools & Drawing Events ==================== */
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

  // Decision
  drawBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'draw');
  });
  skipBtn.addEventListener('click', () => {
    socket.emit('drawChoice', 'skip');
  });

  // Mouse
  myCanvas.addEventListener('mousedown', (e) => {
    if (!amICurrentDrawer || !isDrawingPhase) return;
    e.preventDefault();
    startDrawing(e.clientX, e.clientY);
  });
  myCanvas.addEventListener('mousemove', (e) => {
    if (drawing) {
      e.preventDefault();
      moveDrawing(e.clientX, e.clientY);
    }
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

  // Touch
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

  function startDrawing(cx, cy) {
    drawing = true;
    pathPoints = [];
    const { x, y } = getCanvasCoords(cx, cy);
    lastX = x;
    lastY = y;
    pathPoints.push({ x, y });
  }
  function moveDrawing(cx, cy) {
    const { x, y } = getCanvasCoords(cx, cy);
    socket.emit('partialDrawing', {
      fromX: lastX, fromY: lastY, toX: x, toY: y,
      color: currentColor, thickness: currentThickness
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

  /* ==================== Chat ==================== */
  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  chatSendPortrait.addEventListener('click', sendChatPortrait);
  chatInputPortrait.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatPortrait(); });

  function sendChat() {
    const text = chatInput.value.trim();
    if (text) {
      socket.emit('chatMessage', text);
      chatInput.value = '';
    }
  }
  function sendChatPortrait() {
    const text = chatInputPortrait.value.trim();
    if (text) {
      socket.emit('chatMessage', text);
      chatInputPortrait.value = '';
    }
  }

  /* ==================== Socket Events ==================== */

  // If the server accepted our lobby join, we expect to see the initCanvas event, etc.
  socket.on('initCanvas', (allStrokes) => {
    // Switch from lobbyPrompt to game
    lobbyPrompt.style.display = 'none';
    gameContainer.style.display = 'flex';

    strokes = allStrokes;
    redrawCanvas();
  });

  socket.on('initChat', (messages) => {
    // Clear both chat boxes
    chatBox.innerHTML = '';
    chatBoxPortrait.innerHTML = '';
    messages.forEach((m) => appendChat(m.username, m.text));
  });

  // partial
  socket.on('partialDrawing', ({ fromX, fromY, toX, toY, color, thickness }) => {
    drawSegment(fromX, fromY, toX, toY, color || '#000', thickness || 1, 0.4);
  });

  // final
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

  // Chat
  socket.on('chatMessage', (msg) => {
    appendChat(msg.username, msg.text);
  });

  // Turn info
  socket.on('turnInfo', (data) => {
    const { currentPlayerId, currentPlayerName, isDrawingPhase, timeLeft } = data;
    amICurrentDrawer = (socket.id === currentPlayerId);
    if (isDrawingPhase) {
      // is it a 70s drawing phase
      drawingTools.style.display = amICurrentDrawer ? 'flex' : 'none';
      decisionButtons.style.display = 'none';
    } else {
      // 10s decision phase
      decisionButtons.style.display = amICurrentDrawer ? 'flex' : 'none';
      drawingTools.style.display = 'none';
    }

    turnInfo.textContent = amICurrentDrawer
      ? isDrawingPhase
        ? 'You are drawing now!'
        : 'It’s your turn! Decide if you want to draw.'
      : isDrawingPhase
        ? `${currentPlayerName} is drawing...`
        : `${currentPlayerName} is deciding...`;

    stopCountdown();
    startCountdown(timeLeft, (remaining) => {
      if (amICurrentDrawer) {
        if (isDrawingPhase) {
          turnInfo.textContent = `Drawing! ${remaining}s left...`;
        } else {
          turnInfo.textContent = `You have ${remaining}s to choose: Draw or Skip`;
        }
      } else {
        if (isDrawingPhase) {
          turnInfo.textContent = `${currentPlayerName} is drawing... ${remaining}s left`;
        } else {
          turnInfo.textContent = `${currentPlayerName} is deciding... ${remaining}s left`;
        }
      }
    });
  });

  // Players list
  socket.on('playersList', (players) => {
    // Landscape
    playersList.innerHTML = '';
    // Portrait
    playersListPortrait.innerHTML = '';

    players.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'player-item';
      // Could also show color swatch if you want
      div.textContent = p.username;
      playersList.appendChild(div);

      const div2 = document.createElement('div');
      div2.className = 'player-item';
      div2.textContent = p.username;
      playersListPortrait.appendChild(div2);
    });
  });

  /* ==================== Helpers ==================== */
  function getCanvasCoords(cx, cy) {
    const rect = myCanvas.getBoundingClientRect();
    return {
      x: cx - rect.left,
      y: cy - rect.top
    };
  }

  function drawSegment(x1, y1, x2, y2, color, thickness, alpha=1) {
    ctx.save();
    ctx.strokeStyle = color;
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
    ctx.globalAlpha = 1;
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

  function appendChat(username, text) {
    const msg = document.createElement('div');
    msg.textContent = `${username}: ${text}`;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;

    // Also in portrait
    const msg2 = document.createElement('div');
    msg2.textContent = `${username}: ${text}`;
    chatBoxPortrait.appendChild(msg2);
    chatBoxPortrait.scrollTop = chatBoxPortrait.scrollHeight;
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
        updateCountdownBar(secondsLeft / total);
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
    countdownFill.style.width = `${progress * 100}%`;
  }
  function updateCountdownNumber(num) {
    countdownNumber.textContent = `${num}s`;
  }
});
