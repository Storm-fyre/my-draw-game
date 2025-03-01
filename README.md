# My Draw Game

A drawasaurus-like game for mobile phones with real-time drawing, chat, and a player lobby.

## Features

- **Real-time Multiplayer:**  
  Players join via a shared link and enter a single lobby.

- **Dynamic Layout:**  
  - The screen is split into a square canvas (upper part) and a bottom box that toggles between a chat message list and a player list.
  - Layout adjusts dynamically for different portrait screen sizes and when the on-screen keyboard appears.

- **Drawing Tools:**  
  - 5 brush thickness options.
  - 18 color options covering basic colors.

- **Live Drawing Updates:**  
  Drawing strokes are transmitted in real time so all players see the drawing progress as it happens.

## Folder Structure
my-draw-game/ ├── package.json # Project configuration and dependencies. ├── README.md # Project documentation. ├── server/ │ └── index.js # Server-side code with Express and Socket.io. └── public/ ├── index.html # Main HTML file. ├── style.css # CSS for layout and styling. └── app.js # Client-side JavaScript code.

## Getting Started

1. **Clone the Repository:**

    ```bash
    git clone <repository-url>
    cd my-draw-game
    ```

2. **Install Dependencies:**

    ```bash
    npm install
    ```

3. **Start the Server:**

    ```bash
    npm start
    ```

4. **Play the Game:**

    Open your browser and navigate to `http://localhost:3000` (or use your mobile device).

---

This implementation meets the requirements:
- Dynamic, portrait‑oriented layout with a square canvas and full‑use bottom box.
- Toggle between chat messages (last 15 messages stored, scrollable) and player list.
- Real‑time drawing with selectable brush thickness and color.
- Live updates to all players in the same lobby.

Feel free to modify and extend as needed!