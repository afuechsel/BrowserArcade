(() => {
  // Arcade controller / router:
  // - owns the shared canvas + HUD elements (score/best/lives)
  // - starts/stops the currently selected game
  // - provides a common set of DOM refs to each game via start(...)
  // - handles global keys that should work across all games (Esc menu, M mute)
  const canvas = document.getElementById("game");

  const titleEl = document.getElementById("game-title");
  const helpEl = document.getElementById("help");

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const livesEl = document.getElementById("lives");

  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlay-title");
  const overlaySubtitleEl = document.getElementById("overlay-subtitle");

  const menuEl = document.getElementById("menu");
  const btnSnake = document.getElementById("btn-snake");
  const btnPacman = document.getElementById("btn-pacman");
  const btnTetris = document.getElementById("btn-tetris");
  const btnBreakout = document.getElementById("btn-breakout");

  let current = null;
  let muted = false;

  function setHelp(lines) {
    helpEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  }

  function showMenu() {
    // Stop any running game and reset HUD for the menu screen.
    if (current?.stop) current.stop();
    current = null;

    overlayEl.hidden = true;
    menuEl.hidden = false;

    titleEl.textContent = "Arcade";
    scoreEl.textContent = "0";
    bestEl.textContent = "0";
    // Games that don't implement lives will display '-' here.
    livesEl.textContent = "-";

    setHelp([
      "<strong>Choose</strong>: click a game",
      "<strong>Mute</strong>: M",
      "<strong>Back to menu</strong>: Esc",
    ]);
  }

  function hideMenu() {
    menuEl.hidden = true;
  }

  function commonStartArgs() {
    // Shared wiring passed into each game so games can update the HUD and overlay.
    return {
      canvas,
      scoreEl,
      bestEl,
      overlayEl,
      overlayTitleEl,
      overlaySubtitleEl,
    };
  }

  function startSnake() {
    hideMenu();
    titleEl.textContent = "Snake";
    // Snake exposes a lives system (3 lives per run) and will keep this updated.
    livesEl.textContent = "3";
    setHelp([
      "<strong>Move</strong>: Arrow keys / WASD",
      "<strong>Pause</strong>: Space",
      "<strong>Mute</strong>: M",
      "<strong>Restart</strong>: R",
      "<strong>Menu</strong>: Esc",
    ]);

    current = window.SnakeGame;
    // Pass the shared lives element only to games that support it.
    current.start({ ...commonStartArgs(), livesEl });
    if (current.setMuted) current.setMuted(muted);
  }

  function startPacman() {
    hideMenu();
    titleEl.textContent = "Pac-Man";
    // Pac-Man exposes a lives system (3 lives per run) and will keep this updated.
    livesEl.textContent = "3";
    setHelp([
      "<strong>Move</strong>: Arrow keys / WASD",
      "<strong>Pause</strong>: Space",
      "<strong>Mute</strong>: M",
      "<strong>Restart</strong>: R",
      "<strong>Menu</strong>: Esc",
    ]);

    current = window.PacmanGame;
    current.start({ ...commonStartArgs(), livesEl });
    if (current.setMuted) current.setMuted(muted);
  }

  function startTetris() {
    hideMenu();
    titleEl.textContent = "Tetris";
    // Tetris doesn't use lives; keep the HUD consistent by showing '-'.
    livesEl.textContent = "-";
    setHelp([
      "<strong>Move</strong>: Left/Right (or A/D)",
      "<strong>Rotate</strong>: Up (or W)",
      "<strong>Soft drop</strong>: Down (or S)",
      "<strong>Hard drop</strong>: Space",
      "<strong>Pause</strong>: P",
      "<strong>Mute</strong>: M",
      "<strong>Restart</strong>: R",
      "<strong>Menu</strong>: Esc",
    ]);

    current = window.TetrisGame;
    current.start(commonStartArgs());
    if (current.setMuted) current.setMuted(muted);
  }

  function startBreakout() {
    hideMenu();
    titleEl.textContent = "Breakout";
    livesEl.textContent = "3";
    setHelp([
      "<strong>Move</strong>: Left/Right (or A/D)",
      "<strong>Launch</strong>: Space",
      "<strong>Pause</strong>: P",
      "<strong>Mute</strong>: M",
      "<strong>Restart</strong>: R",
      "<strong>Menu</strong>: Esc",
    ]);

    current = window.BreakoutGame;
    current.start({ ...commonStartArgs(), livesEl });
    if (current.setMuted) current.setMuted(muted);
  }

  btnSnake.addEventListener("click", () => startSnake());
  btnPacman.addEventListener("click", () => startPacman());
  btnTetris.addEventListener("click", () => startTetris());
  btnBreakout.addEventListener("click", () => startBreakout());

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    if (key === "escape") {
      // Always allow escaping back to the menu, regardless of current game.
      e.preventDefault();
      showMenu();
      return;
    }

    if (key === "m") {
      // Global mute toggle forwarded to the current game.
      muted = !muted;
      if (current?.setMuted) current.setMuted(muted);
      return;
    }
  });

  showMenu();
})();
