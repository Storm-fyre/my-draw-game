document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Element references
  const nicknameModal = document.getElementById('nicknameModal');
  const nicknameInput = document.getElementById('nicknameInput');
  const joinBtn = document.getElementById('joinBtn');
  const drawingCanvas = document.getElementById('drawingCanvas');
  const ctx = drawingCanvas.getContext('2d');
  const thicknessButtons = document.querySelectorAll('.thickness');
  const colorButtons = document.querySelectorAll('.color');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const messagesDiv = document.getElementById('messages');
  const toggleBtn = document.getElementById('toggleBtn');
  const messageBox = document.getElementById('messageBox');
  const playerBox = document.getElementById('playerBox');
  const playersDiv = document.getElementById('players');

  let drawing = false;
  let current = {
    color: '#000000',
    thickness: 2
  };
  let nickname = '';

  // Adjust canvas to be square based on top container's width.
  function resizeCanvas() {
    const topContainer = document.getElementById('topContainer');
    const width = topContainer.clientWidth;
    drawingCanvas.width = width;
    drawingCanvas.height = width;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Handle dynamic layout when keyboard appears.
  function adjustLayout() {
    const availableHeight = window.innerHeight;
    const topContainer = document.getElementById('topContainer');
    const bottomContainer = document.getElementById('bottomContainer');

    // Ensure canvas (in topContainer) remains square.
    const canvasWidth = topContainer.clientWidth;
    topContainer.style.height = canvasWidth + 'px';

    // Bottom container takes up the rest of the space.
    bottomContainer.style.height = (availableHeight - canvasWidth) + 'px';
  }

  window.addEventListener('resize', adjustLayout);
  adjustLayout();

  // Nickname join handler.
  joinBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (name) {
      nickname = name;
      socket.emit('join', nickname);
      nicknameModal.style.display = 'none';
    }
  });

  // Toggle between message box and player box.
  toggleBtn.addEventListener('click', () => {
    if (messageBox.classList.contains('active')) {
      messageBox.classList.remove('active');
      playerBox.classList.add('active');
      toggleBtn.textContent = 'Messages';
    } else {
      playerBox.classList.remove('active');
      messageBox.classList.add('active');
      toggleBtn.textContent = 'Players';
    }
  });

  // Chat message submission.
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (message) {
      const data = { nickname, message };
      socket.emit('chatMessage', data);
      appendMessage(data);
      chatInput.value = '';
    }
  });

  // Append a chat message to the messages box.
  function appendMessage(data) {
    const messageEl = document.createElement('div');
    messageEl.textContent = `${data.nickname}: ${data.message}`;
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // Update player list when received from the server.
  socket.on('playerList', (players) => {
    playersDiv.innerHTML = '';
    players.forEach(player => {
      const playerEl = document.createElement('div');
      playerEl.textContent = player.nickname;
      playersDiv.appendChild(playerEl);
    });
  });

  // Receive and display chat messages from server.
  socket.on('chatMessage', (data) => {
    appendMessage(data);
  });

  // Draw a line on the canvas.
  function drawLine(x0, y0, x1, y1, color, thickness, emit) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.closePath();

    if (!emit) return;
    const w = drawingCanvas.width;
    const h = drawingCanvas.height;
    socket.emit('drawing', {
      x0: x0 / w,
      y0: y0 / h,
      x1: x1 / w,
      y1: y1 / h,
      color: color,
      thickness: thickness
    });
  }

  // Handle mouse/touch events for drawing.
  let lastX = 0;
  let lastY = 0;

  function onMouseDown(e) {
    drawing = true;
    const rect = drawingCanvas.getBoundingClientRect();
    lastX = (e.clientX || e.touches[0].clientX) - rect.left;
    lastY = (e.clientY || e.touches[0].clientY) - rect.top;
  }

  function onMouseMove(e) {
    if (!drawing) return;
    const rect = drawingCanvas.getBoundingClientRect();
    const currentX = (e.clientX || e.touches[0].clientX) - rect.left;
    const currentY = (e.clientY || e.touches[0].clientY) - rect.top;
    drawLine(lastX, lastY, currentX, currentY, current.color, current.thickness, true);
    lastX = currentX;
    lastY = currentY;
  }

  function onMouseUp() {
    if (!drawing) return;
    drawing = false;
  }

  drawingCanvas.addEventListener('mousedown', onMouseDown);
  drawingCanvas.addEventListener('mousemove', onMouseMove);
  drawingCanvas.addEventListener('mouseup', onMouseUp);
  drawingCanvas.addEventListener('mouseout', onMouseUp);

  // Touch events for mobile.
  drawingCanvas.addEventListener('touchstart', onMouseDown);
  drawingCanvas.addEventListener('touchmove', onMouseMove);
  drawingCanvas.addEventListener('touchend', onMouseUp);
  drawingCanvas.addEventListener('touchcancel', onMouseUp);

  // Listen for drawing data from other players.
  socket.on('drawing', (data) => {
    const w = drawingCanvas.width;
    const h = drawingCanvas.height;
    drawLine(data.x0 * w, data.y0 * h, data.x1 * w, data.y1 * h, data.color, data.thickness);
  });

  // Tool selection for brush thickness.
  thicknessButtons.forEach(button => {
    button.addEventListener('click', () => {
      current.thickness = parseInt(button.getAttribute('data-thickness'));
      thicknessButtons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
    });
  });
  // Set default thickness.
  thicknessButtons[0].classList.add('selected');

  // Tool selection for color.
  colorButtons.forEach(button => {
    button.addEventListener('click', () => {
      current.color = button.getAttribute('data-color');
      colorButtons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
    });
  });
  // Set default color.
  colorButtons[0].classList.add('selected');
});
