(() => {
  function createPacmanGame() {
    // Pac-Man game module.
    // Exposes start()/stop() and mute helpers.
    // start(...) receives DOM elements (canvas, HUD spans, overlay) from app.js.
    let canvas;
    let ctx;

    let scoreEl;
    let bestEl;
    let livesEl;

    let overlayEl;
    let overlayTitleEl;
    let overlaySubtitleEl;

    let rafId = null;
    let runningAttached = false;
    let keydownHandler;
    let pointerdownHandler;

    let lifeLostTimeoutId = null;

    const STORAGE_KEY = "pacman_best_score";

    const TILE = 20;
    const FPS_DT_LIMIT = 0.05;

    const DIRS = {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      none: { x: 0, y: 0 },
    };

    const MAZE = [
      "#####################",
      "#.........#.........#",
      "#.###.###.#.###.###.#",
      "#o###.###.#.###.###o#",
      "#...................#",
      "#.###.#.#####.#.###.#",
      "#.....#...#...#.....#",
      "#####.### # ###.#####",
      "    #.#   G   #.#    ",
      "#####.# ## ## #.#####",
      "#.........#.........#",
      "#.###.###.#.###.###.#",
      "#o..#.....P.....#..o#",
      "###.#.#.#####.#.#.###",
      "#.....#...#...#.....#",
      "#.######### #########",
      "#...................#",
      "#####################",
    ];

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function randInt(min, maxInclusive) {
      return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
    }

    function posKey(x, y) {
      return `${x},${y}`;
    }

    function getBestScore() {
      const raw = localStorage.getItem(STORAGE_KEY);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    }

    function setBestScore(value) {
      localStorage.setItem(STORAGE_KEY, String(value));
    }

    let audioState = {
      ctx: null,
      master: null,
      muted: false,
    };

    function ensureAudio() {
      if (audioState.ctx) return true;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      try {
        const ctx = new AudioCtx();
        const master = ctx.createGain();
        master.gain.value = audioState.muted ? 0 : 0.6;
        master.connect(ctx.destination);
        audioState = { ctx, master, muted: audioState.muted };
        return true;
      } catch {
        return false;
      }
    }

    function resumeAudioIfNeeded() {
      if (!audioState.ctx) return;
      if (audioState.ctx.state === "suspended") {
        audioState.ctx.resume().catch(() => {});
      }
    }

    function setMuted(muted) {
      audioState.muted = muted;
      if (audioState.master) audioState.master.gain.value = muted ? 0 : 0.6;
    }

    function toggleMuted() {
      setMuted(!audioState.muted);
    }

    function playTone({ type, freq, durationMs, gain = 0.2, attackMs = 2, releaseMs = 40 }) {
      if (!ensureAudio()) return;
      resumeAudioIfNeeded();
      if (audioState.muted) return;

      const ctxA = audioState.ctx;
      const osc = ctxA.createOscillator();
      const g = ctxA.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctxA.currentTime);

      const now = ctxA.currentTime;
      const dur = Math.max(0.02, durationMs / 1000);
      const attack = Math.max(0.001, attackMs / 1000);
      const release = Math.max(0.001, releaseMs / 1000);

      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.001, dur - release));

      osc.connect(g);
      g.connect(audioState.master);

      osc.start(now);
      osc.stop(now + dur + 0.02);
    }

    function playWaka() {
      playTone({ type: "square", freq: 420, durationMs: 35, gain: 0.08, attackMs: 1, releaseMs: 20 });
    }

    function playPower() {
      playTone({ type: "triangle", freq: 220, durationMs: 120, gain: 0.14, attackMs: 2, releaseMs: 80 });
      playTone({ type: "sine", freq: 330, durationMs: 120, gain: 0.11, attackMs: 2, releaseMs: 80 });
    }

    function playEatGhost() {
      playTone({ type: "sine", freq: 880, durationMs: 90, gain: 0.15, attackMs: 1, releaseMs: 60 });
      playTone({ type: "triangle", freq: 1320, durationMs: 90, gain: 0.12, attackMs: 1, releaseMs: 60 });
    }

    function playDeath() {
      playTone({ type: "sawtooth", freq: 180, durationMs: 240, gain: 0.24, attackMs: 2, releaseMs: 160 });
      playTone({ type: "square", freq: 90, durationMs: 200, gain: 0.12, attackMs: 1, releaseMs: 160 });
    }

    const COLORS = {
      wall: "#2b5cff",
      pellet: "#ffe9a6",
      power: "#ffffff",
      pac: "#ffd200",
      ghost: ["#ff4d4d", "#ff8c3a", "#3ad1ff", "#ff6fe0"],
      frightened: "#2f7bff",
    };

    function parseMaze() {
      const rows = MAZE.length;
      const cols = Math.max(...MAZE.map((r) => r.length));

      const grid = Array.from({ length: rows }, (_, y) => {
        const row = MAZE[y];
        return Array.from({ length: cols }, (_, x) => row[x] ?? " ");
      });

      let pacStart = { x: 1, y: 1 };
      let ghostGate = null;

      const pellets = new Set();
      const power = new Set();

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const c = grid[y][x];
          if (c === ".") pellets.add(posKey(x, y));
          if (c === "o") power.add(posKey(x, y));
          if (c === "P") {
            pacStart = { x, y };
            grid[y][x] = " ";
          }
          if (c === "G") {
            ghostGate = { x, y };
            grid[y][x] = " ";
          }
        }
      }

      return { grid, rows, cols, pellets, power, pacStart, ghostGate };
    }

    function isWall(grid, x, y) {
      if (y < 0 || y >= grid.length) return true;
      if (x < 0 || x >= grid[0].length) return true;
      return grid[y][x] === "#";
    }

    function canMove(grid, x, y) {
      return !isWall(grid, x, y);
    }

    function wrapTunnel(cols, x) {
      if (x < 0) return cols - 1;
      if (x >= cols) return 0;
      return x;
    }

    let state;

    // Update the HUD lives display. We keep this as a helper so:
    // - reset can initialize it
    // - death can decrement it
    // - stop can clear state and the UI can fall back to '-'
    function updateLivesUi() {
      if (!livesEl) return;
      livesEl.textContent = state ? String(state.lives) : "-";
    }

    function showOverlay(title, subtitle) {
      overlayTitleEl.textContent = title;
      overlaySubtitleEl.textContent = subtitle;
      overlayEl.hidden = false;
    }

    function hideOverlay() {
      overlayEl.hidden = true;
    }

    function resetState() {
      // Full reset used by start() and R-key restart.
      // This resets the maze, pellets, score, and restores lives back to 3.
      const parsed = parseMaze();
      state = {
        ...parsed,
        score: 0,
        best: getBestScore(),
        lives: 3,
        running: true,
        paused: false,
        lastTs: 0,
        lastWakaTs: 0,
        frightenedUntil: 0,
        pac: {
          x: parsed.pacStart.x,
          y: parsed.pacStart.y,
          dir: DIRS.left,
          wish: DIRS.left,
          moveAccum: 0,
          speed: 7.2,
        },
        ghosts: [],
      };

      const gx = parsed.ghostGate?.x ?? Math.floor(parsed.cols / 2);
      const gy = parsed.ghostGate?.y ?? Math.floor(parsed.rows / 2);

      for (let i = 0; i < 4; i += 1) {
        state.ghosts.push({
          id: i,
          x: gx + (i % 2),
          y: gy + Math.floor(i / 2),
          dir: DIRS.left,
          moveAccum: 0,
          speed: 4.3 + i * 0.15,
          respawnX: gx,
          respawnY: gy,
        });
      }

      scoreEl.textContent = String(state.score);
      bestEl.textContent = String(state.best);
      updateLivesUi();
      hideOverlay();
      draw(performance.now());
    }

    function resetActorsPositions() {
      // Respawn logic used after losing a life.
      // This keeps the maze + remaining pellets/power pellets + score intact,
      // and only resets Pac-Man/ghost positions and clears frightened state.
      const p = state.pac;
      p.x = state.pacStart.x;
      p.y = state.pacStart.y;
      p.dir = DIRS.left;
      p.wish = DIRS.left;
      p.moveAccum = 0;

      const gx = state.ghostGate?.x ?? Math.floor(state.cols / 2);
      const gy = state.ghostGate?.y ?? Math.floor(state.rows / 2);
      for (let i = 0; i < state.ghosts.length; i += 1) {
        const g = state.ghosts[i];
        g.x = gx + (i % 2);
        g.y = gy + Math.floor(i / 2);
        g.dir = DIRS.left;
        g.moveAccum = 0;
        g.respawnX = gx;
        g.respawnY = gy;
      }

      state.frightenedUntil = 0;
      state.lastTs = 0;
    }

    function loseLife() {
      // Called when Pac-Man touches a ghost while NOT frightened.
      // - decrement lives
      // - if any remain: show a short overlay and respawn actors
      // - else: go to full Game Over
      if (!state.running) return;

      playDeath();

      state.lives = Math.max(0, state.lives - 1);
      updateLivesUi();

      if (state.lives <= 0) {
        gameOver(false);
        return;
      }

      showOverlay("Life lost", `Lives left: ${state.lives}`);
      if (lifeLostTimeoutId) window.clearTimeout(lifeLostTimeoutId);
      lifeLostTimeoutId = window.setTimeout(() => {
        lifeLostTimeoutId = null;
        if (state && state.running && !state.paused) hideOverlay();
      }, 900);

      resetActorsPositions();
    }

    function setPaused(paused) {
      state.paused = paused;
      if (paused) showOverlay("Paused", "Press Space to resume");
      else {
        hideOverlay();
        state.lastTs = performance.now();
      }
    }

    function gameOver(win) {
      state.running = false;
      state.paused = false;

      if (state.score > state.best) {
        state.best = state.score;
        setBestScore(state.best);
      }

      bestEl.textContent = String(state.best);
      showOverlay(win ? "You Win" : "Game Over", "Press R to restart (Esc for menu)");
    }

    function tryTurn(entity, wishDir) {
      const nx = entity.x + wishDir.x;
      const ny = entity.y + wishDir.y;
      if (canMove(state.grid, wrapTunnel(state.cols, nx), ny)) {
        entity.dir = wishDir;
      }
    }

    function stepPac(dt) {
      const p = state.pac;
      p.moveAccum += dt * p.speed;

      while (p.moveAccum >= 1) {
        p.moveAccum -= 1;

        if (p.wish !== DIRS.none) tryTurn(p, p.wish);

        const nx = wrapTunnel(state.cols, p.x + p.dir.x);
        const ny = p.y + p.dir.y;

        if (!canMove(state.grid, nx, ny)) {
          p.dir = DIRS.none;
          break;
        }

        p.x = nx;
        p.y = ny;

        const k = posKey(p.x, p.y);
        if (state.pellets.has(k)) {
          state.pellets.delete(k);
          state.score += 10;
          scoreEl.textContent = String(state.score);

          if (performance.now() - state.lastWakaTs > 45) {
            playWaka();
            state.lastWakaTs = performance.now();
          }
        }

        if (state.power.has(k)) {
          state.power.delete(k);
          state.score += 50;
          scoreEl.textContent = String(state.score);
          state.frightenedUntil = performance.now() + 6500;
          playPower();
        }

        if (state.pellets.size === 0 && state.power.size === 0) {
          gameOver(true);
          return;
        }
      }
    }

    function chooseGhostDir(g) {
      const dirs = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];
      const options = [];

      for (let i = 0; i < dirs.length; i += 1) {
        const d = dirs[i];
        if (g.dir.x === -d.x && g.dir.y === -d.y) continue;
        const nx = wrapTunnel(state.cols, g.x + d.x);
        const ny = g.y + d.y;
        if (!canMove(state.grid, nx, ny)) continue;
        options.push(d);
      }

      if (!options.length) {
        return { x: -g.dir.x, y: -g.dir.y };
      }

      const frightened = performance.now() < state.frightenedUntil;
      const px = state.pac.x;
      const py = state.pac.y;

      let best = options[0];
      let bestScore = Infinity;

      for (let i = 0; i < options.length; i += 1) {
        const d = options[i];
        const nx = wrapTunnel(state.cols, g.x + d.x);
        const ny = g.y + d.y;

        const dist = Math.abs(nx - px) + Math.abs(ny - py);
        const score = frightened ? -dist : dist;

        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }

      if (Math.random() < 0.15) {
        return options[randInt(0, options.length - 1)];
      }

      return best;
    }

    function stepGhosts(dt) {
      for (let gi = 0; gi < state.ghosts.length; gi += 1) {
        const g = state.ghosts[gi];
        g.moveAccum += dt * g.speed;

        while (g.moveAccum >= 1) {
          g.moveAccum -= 1;

          if ((g.x + g.y) % 2 === 0) {
            g.dir = chooseGhostDir(g);
          }

          const nx = wrapTunnel(state.cols, g.x + g.dir.x);
          const ny = g.y + g.dir.y;

          if (!canMove(state.grid, nx, ny)) {
            g.dir = chooseGhostDir(g);
            break;
          }

          g.x = nx;
          g.y = ny;
        }
      }
    }

    function handleCollisions() {
      // Ghost collision handling:
      // - if frightened: eat ghost and send it back to its respawn position
      // - else: lose a life (or game over when lives are exhausted)
      const frightened = performance.now() < state.frightenedUntil;
      const px = state.pac.x;
      const py = state.pac.y;

      for (let gi = 0; gi < state.ghosts.length; gi += 1) {
        const g = state.ghosts[gi];
        if (g.x === px && g.y === py) {
          if (frightened) {
            state.score += 200;
            scoreEl.textContent = String(state.score);
            playEatGhost();
            g.x = g.respawnX;
            g.y = g.respawnY;
            g.dir = DIRS.left;
            g.moveAccum = 0;
          } else {
            loseLife();
          }
          return;
        }
      }
    }

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      const offsetX = Math.floor((w - state.cols * TILE) / 2);
      const offsetY = Math.floor((h - state.rows * TILE) / 2);

      ctx.save();
      ctx.translate(offsetX, offsetY);

      for (let y = 0; y < state.rows; y += 1) {
        for (let x = 0; x < state.cols; x += 1) {
          if (state.grid[y][x] === "#") {
            ctx.fillStyle = COLORS.wall;
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
      }

      ctx.fillStyle = COLORS.pellet;
      for (const key of state.pellets) {
        const [x, y] = key.split(",").map(Number);
        ctx.beginPath();
        ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 160);
      ctx.fillStyle = COLORS.power;
      for (const key of state.power) {
        const [x, y] = key.split(",").map(Number);
        ctx.beginPath();
        ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, 5.2 * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      const p = state.pac;
      ctx.fillStyle = COLORS.pac;
      const mouth = 0.22 + 0.18 * Math.sin(performance.now() / 80);
      const angle = Math.atan2(p.dir.y, p.dir.x);
      ctx.beginPath();
      ctx.moveTo(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
      ctx.arc(
        p.x * TILE + TILE / 2,
        p.y * TILE + TILE / 2,
        TILE * 0.45,
        angle + mouth,
        angle - mouth + Math.PI * 2,
        false
      );
      ctx.closePath();
      ctx.fill();

      const nowMs = performance.now();
      const frightened = nowMs < state.frightenedUntil;
      const flickerWindowMs = 2000;
      const flickerPeriodMs = 180;
      const flicker =
        frightened &&
        state.frightenedUntil - nowMs < flickerWindowMs &&
        Math.floor((state.frightenedUntil - nowMs) / flickerPeriodMs) % 2 === 0;
      for (let i = 0; i < state.ghosts.length; i += 1) {
        const g = state.ghosts[i];
        const gx = g.x * TILE + TILE / 2;
        const gy = g.y * TILE + TILE / 2;

        ctx.fillStyle = frightened && !flicker ? COLORS.frightened : COLORS.ghost[g.id];
        ctx.beginPath();
        ctx.arc(gx, gy, TILE * 0.42, Math.PI, 0);
        ctx.lineTo(gx + TILE * 0.42, gy + TILE * 0.42);
        ctx.lineTo(gx - TILE * 0.42, gy + TILE * 0.42);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(gx - 4, gy - 2, 3, 0, Math.PI * 2);
        ctx.arc(gx + 4, gy - 2, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.arc(gx - 4, gy - 2, 1.2, 0, Math.PI * 2);
        ctx.arc(gx + 4, gy - 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function loop(ts) {
      // Main animation loop (requestAnimationFrame).
      // Even when the game is over, we keep drawing so the overlay stays visible.
      if (!state) return;
      if (!state.running) {
        draw();
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (!state.lastTs) state.lastTs = ts;
      const dt = clamp((ts - state.lastTs) / 1000, 0, FPS_DT_LIMIT);
      state.lastTs = ts;

      if (!state.paused) {
        stepPac(dt);
        stepGhosts(dt);
        handleCollisions();
      }

      draw();
      rafId = requestAnimationFrame(loop);
    }

    function attachListeners() {
      if (runningAttached) return;
      runningAttached = true;

      keydownHandler = (e) => {
        ensureAudio();
        resumeAudioIfNeeded();

        const key = e.key.toLowerCase();

        if (key === " " || key === "spacebar") {
          e.preventDefault();
          if (!state?.running) return;
          setPaused(!state.paused);
          return;
        }

        if (key === "r") {
          resetState();
          return;
        }

        if (key === "m") {
          toggleMuted();
          return;
        }

        if (key === "arrowup" || key === "w") {
          e.preventDefault();
          state.pac.wish = DIRS.up;
          return;
        }
        if (key === "arrowdown" || key === "s") {
          e.preventDefault();
          state.pac.wish = DIRS.down;
          return;
        }
        if (key === "arrowleft" || key === "a") {
          e.preventDefault();
          state.pac.wish = DIRS.left;
          return;
        }
        if (key === "arrowright" || key === "d") {
          e.preventDefault();
          state.pac.wish = DIRS.right;
        }
      };

      pointerdownHandler = () => {
        ensureAudio();
        resumeAudioIfNeeded();
      };

      window.addEventListener("keydown", keydownHandler);
      window.addEventListener("pointerdown", pointerdownHandler, { passive: true });
    }

    function detachListeners() {
      if (!runningAttached) return;
      runningAttached = false;
      window.removeEventListener("keydown", keydownHandler);
      window.removeEventListener("pointerdown", pointerdownHandler);
    }

    function start({
      canvas: c,
      scoreEl: s,
      bestEl: b,
      livesEl: l,
      overlayEl: o,
      overlayTitleEl: ot,
      overlaySubtitleEl: os,
    }) {
      // Bootstraps the game with DOM elements provided by app.js.
      // This is how the game updates the HUD and overlay without owning the layout.
      canvas = c;
      ctx = canvas.getContext("2d");

      scoreEl = s;
      bestEl = b;
      livesEl = l;

      overlayEl = o;
      overlayTitleEl = ot;
      overlaySubtitleEl = os;

      attachListeners();
      resetState();
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      // Stop rendering, detach input handlers, and clear state.
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      detachListeners();
      if (lifeLostTimeoutId) window.clearTimeout(lifeLostTimeoutId);
      lifeLostTimeoutId = null;
      if (overlayEl) overlayEl.hidden = true;
      state = null;
    }

    function setMutedExternal(muted) {
      setMuted(muted);
    }

    return {
      start,
      stop,
      setMuted: setMutedExternal,
      toggleMuted,
    };
  }

  window.PacmanGame = createPacmanGame();
})();
