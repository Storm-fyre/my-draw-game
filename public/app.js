const socket = io();

let nickname = "";
let brushColor = "#000000";
let brushThickness = 4;

const drawingCanvas = document.getElementById("drawingCanvas");
const ctx = drawingCanvas.getContext("2d");

// Variables for drawing
let drawing = false;
let lastPos = { x: 0, y: 0 };
let currentPath = [];
let paths = []; // local history for undo

// UI Elements
const nicknameModal = document.getElementById("nicknameModal");
const joinBtn = document.getElementById("joinBtn");
const nicknameInput = document.getElementById("nicknameInput");
const gameContainer = document.getElementById("gameContainer");

const boxContent = document.getElementById("boxContent");
const toggleBoxBtn = document.getElementById("toggleBox");
const messageInput = document.getElementById("messageInput");
const sendMsgBtn = document.getElementById("sendMsg");

const brushButtons = document.querySelectorAll("#brushThickness button");
const colorButtons = document.querySelectorAll("#colorOptions button");

const turnOverlay = document.getElementById("turnOverlay");
const currentPlayerSpan = document.getElementById("currentPlayer");
const countdownSpan = document.getElementById("countdown");
const drawBtn = document.getElementById("drawBtn");
const skipBtn = document.getElementById("skipBtn");

const drawControls = document.getElementById("drawControls");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const giveupBtn = document.getElementById("giveupBtn");

// Toggle state for box: "messages" or "players"
let boxState = "messages";

// Store messages and players received from server
let messages = [];
let players = [];

// --- Handle Join ---
joinBtn.addEventListener("click", () => {
  nickname = nicknameInput.value.trim();
  if (nickname !== "") {
    socket.emit("join", nickname);
    nicknameModal.classList.add("hidden");
    gameContainer.classList.remove("hidden");
  }
});

// --- Dynamic Resizing ---
function resizeLayout() {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // Canvas: a square sized to use about 60% of the viewport height or full width
  const canvasSize = Math.min(vw, vh * 0.6);
  drawingCanvas.width = canvasSize;
  drawingCanvas.height = canvasSize;
  document.getElementById("canvasContainer").style.height = canvasSize + "px";
  // Box container fills the remaining space
  document.getElementById("boxContainer").style.height = (vh - canvasSize) + "px";
}
window.addEventListener("resize", resizeLayout);
resizeLayout();

// --- Touch Drawing (for mobile) ---
function getTouchPos(canvas, touchEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: touchEvent.touches[0].clientX - rect.left,
    y: touchEvent.touches[0].clientY - rect.top
  };
}

drawingCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  drawing = true;
  const pos = getTouchPos(drawingCanvas, e);
  lastPos = pos;
  currentPath = [pos];
});

drawingCanvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!drawing) return;
  const pos = getTouchPos(drawingCanvas, e);
  currentPath.push(pos);
  drawSmoothLine(lastPos, pos);
  lastPos = pos;
  // Send drawing data in real time
  socket.emit("drawing", { pos, brushColor, brushThickness });
});

drawingCanvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  drawing = false;
  paths.push({ path: currentPath, brushColor, brushThickness });
});

// Draw using a quadratic curve for smoother lines
function drawSmoothLine(start, end) {
  ctx.strokeStyle = brushColor;
  ctx.lineWidth = brushThickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  ctx.quadraticCurveTo(start.x, start.y, midX, midY);
  ctx.stroke();
}

// --- Brush & Color Selection ---
brushButtons.forEach(button => {
  button.addEventListener("click", () => {
    brushThickness = parseInt(button.getAttribute("data-thickness"));
  });
});
colorButtons.forEach(button => {
  button.addEventListener("click", () => {
    brushColor = button.getAttribute("data-color");
  });
});

// --- Messaging and Player List Toggle ---
toggleBoxBtn.addEventListener("click", () => {
  if (boxState === "messages") {
    boxState = "players";
    toggleBoxBtn.textContent = "Players";
  } else {
    boxState = "messages";
    toggleBoxBtn.textContent = "Messages";
  }
  renderBoxContent();
});

// Send message on button click
sendMsgBtn.addEventListener("click", () => {
  const msg = messageInput.value.trim();
  if (msg !== "") {
    socket.emit("message", msg);
    messageInput.value = "";
  }
});

// Render messages or players in the box
function renderBoxContent() {
  boxContent.innerHTML = "";
  if (boxState === "messages") {
    messages.forEach(m => {
      const div = document.createElement("div");
      div.className = "message";
      div.textContent = `${m.nickname}: ${m.text}`;
      boxContent.appendChild(div);
    });
  } else {
    players.forEach(p => {
      const div = document.createElement("div");
      div.className = "player";
      div.textContent = p.nickname;
      boxContent.appendChild(div);
    });
  }
}

// --- Socket.IO Event Handlers ---
socket.on("init", (data) => {
  messages = data.messages || [];
  players = data.players || [];
  renderBoxContent();
  // Draw any previous drawing data (simple rendering for new joiners)
  if (data.drawingData && data.drawingData.length > 0) {
    data.drawingData.forEach(d => {
      ctx.fillStyle = d.brushColor;
      ctx.beginPath();
      ctx.arc(d.pos.x, d.pos.y, d.brushThickness / 2, 0, 2 * Math.PI);
      ctx.fill();
    });
  }
});

socket.on("message", (msg) => {
  messages.push(msg);
  if (messages.length > 15) messages.shift();
  renderBoxContent();
});

socket.on("playerList", (list) => {
  players = list;
  renderBoxContent();
});

socket.on("drawing", (data) => {
  ctx.strokeStyle = data.brushColor;
  ctx.lineWidth = data.brushThickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  // Simple representation: draw a small circle at the point received
  ctx.arc(data.pos.x, data.pos.y, data.brushThickness / 2, 0, 2 * Math.PI);
  ctx.fillStyle = data.brushColor;
  ctx.fill();
});

socket.on("clearCanvas", () => {
  clearLocalCanvas();
});

socket.on("undo", () => {
  paths.pop();
  redrawPaths();
});

socket.on("redraw", (drawingData) => {
  clearLocalCanvas();
  drawingData.forEach(d => {
    ctx.strokeStyle = d.brushColor;
    ctx.lineWidth = d.brushThickness;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(d.pos.x, d.pos.y, d.brushThickness / 2, 0, 2 * Math.PI);
    ctx.fillStyle = d.brushColor;
    ctx.fill();
  });
});

// Helper functions for canvas
function clearLocalCanvas() {
  ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  paths = [];
}

function redrawPaths() {
  clearLocalCanvas();
  paths.forEach(stroke => {
    for (let i = 1; i < stroke.path.length; i++) {
      drawSmoothLine(stroke.path[i - 1], stroke.path[i]);
    }
  });
}

// --- Turn & Drawing Controls ---
socket.on("turn", (player) => {
  currentPlayerSpan.textContent = "Turn: " + player.nickname;
  // If it’s your turn, show drawing controls; otherwise hide them.
  if (player.id === socket.id) {
    drawControls.classList.remove("hidden");
  } else {
    drawControls.classList.add("hidden");
  }
});

socket.on("countdown", (value) => {
  countdownSpan.textContent = value;
});

// Turn button actions
drawBtn.addEventListener("click", () => {
  socket.emit("turnAction", "draw");
});
skipBtn.addEventListener("click", () => {
  socket.emit("turnAction", "skip");
});

// Drawing control buttons
undoBtn.addEventListener("click", () => {
  socket.emit("undo");
});
clearBtn.addEventListener("click", () => {
  socket.emit("clearCanvas");
});
giveupBtn.addEventListener("click", () => {
  socket.emit("turnAction", "giveup");
});
