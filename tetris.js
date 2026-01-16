(() => {
  function createTetrisGame() {
    let canvas;
    let ctx;

    let scoreEl;
    let bestEl;

    let overlayEl;
    let overlayTitleEl;
    let overlaySubtitleEl;

    let rafId = null;
    let runningAttached = false;
    let keydownHandler;
    let pointerdownHandler;

    const STORAGE_KEY = "tetris_best_score";

    const COLS = 10;
    const ROWS = 20;

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function randInt(min, maxInclusive) {
      return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
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
        const ctxA = new AudioCtx();
        const master = ctxA.createGain();
        master.gain.value = audioState.muted ? 0 : 0.6;
        master.connect(ctxA.destination);
        audioState = { ctx: ctxA, master, muted: audioState.muted };
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

    function playTone({ type, freq, durationMs, gain = 0.14, attackMs = 2, releaseMs = 60 }) {
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

    function sfxMove() {
      playTone({ type: "square", freq: 220, durationMs: 25, gain: 0.05, releaseMs: 25 });
    }

    function sfxRotate() {
      playTone({ type: "triangle", freq: 440, durationMs: 40, gain: 0.06, releaseMs: 30 });
    }

    function sfxDrop() {
      playTone({ type: "sine", freq: 330, durationMs: 45, gain: 0.06, releaseMs: 40 });
    }

    function sfxLock() {
      playTone({ type: "sawtooth", freq: 160, durationMs: 70, gain: 0.06, releaseMs: 60 });
    }

    function sfxLineClear(lines) {
      const base = lines >= 4 ? 880 : 660;
      playTone({ type: "sine", freq: base, durationMs: 90, gain: 0.11, releaseMs: 80 });
      playTone({ type: "triangle", freq: base * 1.25, durationMs: 90, gain: 0.09, releaseMs: 80 });
    }

    function sfxGameOver() {
      playTone({ type: "sawtooth", freq: 200, durationMs: 240, gain: 0.18, releaseMs: 180 });
      playTone({ type: "square", freq: 90, durationMs: 240, gain: 0.12, releaseMs: 180 });
    }

    const PIECES = {
      I: {
        color: "#45e7ff",
        cells: [
          [0, 0, 0, 0],
          [1, 1, 1, 1],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      },
      O: {
        color: "#ffd84a",
        cells: [
          [1, 1],
          [1, 1],
        ],
      },
      T: {
        color: "#c77dff",
        cells: [
          [0, 1, 0],
          [1, 1, 1],
          [0, 0, 0],
        ],
      },
      S: {
        color: "#63ff8b",
        cells: [
          [0, 1, 1],
          [1, 1, 0],
          [0, 0, 0],
        ],
      },
      Z: {
        color: "#ff5c5c",
        cells: [
          [1, 1, 0],
          [0, 1, 1],
          [0, 0, 0],
        ],
      },
      J: {
        color: "#4d7dff",
        cells: [
          [1, 0, 0],
          [1, 1, 1],
          [0, 0, 0],
        ],
      },
      L: {
        color: "#ff9a3a",
        cells: [
          [0, 0, 1],
          [1, 1, 1],
          [0, 0, 0],
        ],
      },
    };

    const BAG = ["I", "O", "T", "S", "Z", "J", "L"];

    function rotateCW(mat) {
      const h = mat.length;
      const w = mat[0].length;
      const out = Array.from({ length: w }, () => Array(h).fill(0));
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          out[x][h - 1 - y] = mat[y][x];
        }
      }
      return out;
    }

    function showOverlay(title, subtitle) {
      overlayTitleEl.textContent = title;
      overlaySubtitleEl.textContent = subtitle;
      overlayEl.hidden = false;
    }

    function hideOverlay() {
      overlayEl.hidden = true;
    }

    function makeBoard() {
      return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    }

    function collides(board, piece, px, py) {
      const m = piece.cells;
      for (let y = 0; y < m.length; y += 1) {
        for (let x = 0; x < m[y].length; x += 1) {
          if (!m[y][x]) continue;
          const bx = px + x;
          const by = py + y;
          if (bx < 0 || bx >= COLS || by >= ROWS) return true;
          if (by < 0) continue;
          if (board[by][bx]) return true;
        }
      }
      return false;
    }

    function merge(board, piece, px, py) {
      const m = piece.cells;
      for (let y = 0; y < m.length; y += 1) {
        for (let x = 0; x < m[y].length; x += 1) {
          if (!m[y][x]) continue;
          const bx = px + x;
          const by = py + y;
          if (by < 0) continue;
          board[by][bx] = piece.color;
        }
      }
    }

    function clearLines(board) {
      let cleared = 0;
      for (let y = ROWS - 1; y >= 0; y -= 1) {
        if (board[y].every((c) => c)) {
          board.splice(y, 1);
          board.unshift(Array(COLS).fill(null));
          cleared += 1;
          y += 1;
        }
      }
      return cleared;
    }

    function drawRoundedRect(x, y, w, h, r) {
      const radius = clamp(r, 0, Math.min(w, h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }

    function drawCell(x, y, size, color) {
      const pad = 1.5;
      const rx = x + pad;
      const ry = y + pad;
      const s = size - pad * 2;

      ctx.fillStyle = color;
      drawRoundedRect(rx, ry, s, s, 4);
      ctx.fill();

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#000000";
      drawRoundedRect(rx + 1, ry + 1, s, s, 4);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#ffffff";
      drawRoundedRect(rx + 1.2, ry + 1.2, s * 0.45, s * 0.45, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function draw(ts) {
      const w = canvas.width;
      const h = canvas.height;

      const panelW = 6;
      const cell = Math.floor(Math.min(w / (COLS + panelW + 2), h / (ROWS + 2)));
      const boardW = COLS * cell;
      const boardH = ROWS * cell;
      const previewW = panelW * cell;
      const gap = Math.floor(cell * 1.2);
      const totalW = boardW + gap + previewW;
      const offX = Math.floor((w - totalW) / 2);
      const offY = Math.floor((h - boardH) / 2);

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#080b12");
      grad.addColorStop(1, "#05060a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = "#d0e6ff";
      ctx.lineWidth = 1;
      for (let y = 0; y <= ROWS; y += 1) {
        const py = offY + y * cell + 0.5;
        ctx.beginPath();
        ctx.moveTo(offX, py);
        ctx.lineTo(offX + boardW, py);
        ctx.stroke();
      }
      for (let x = 0; x <= COLS; x += 1) {
        const px = offX + x * cell + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, offY);
        ctx.lineTo(px, offY + boardH);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (!state) return;

      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const c = state.board[y][x];
          if (!c) continue;
          drawCell(offX + x * cell, offY + y * cell, cell, c);
        }
      }

      if (state.active) {
        const ghostY = getHardDropY();
        ctx.globalAlpha = 0.22;
        drawPiece(state.active, state.ax, ghostY, cell, offX, offY, true);
        ctx.globalAlpha = 1;

        drawPiece(state.active, state.ax, state.ay, cell, offX, offY, false);
      }

      const previewX = offX + boardW + gap;
      const previewY = offY;
      const cardW = previewW;
      const cardH = Math.floor(cell * 8.5);

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      drawRoundedRect(previewX, previewY, cardW, cardH, 12);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "rgba(232,238,246,0.9)";
      ctx.font = `${Math.max(10, Math.floor(cell * 0.9))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("Next", previewX + Math.floor(cell * 0.6), previewY + Math.floor(cell * 0.6));

      const nextKind = state.queue.length ? state.queue[0] : null;
      if (nextKind && PIECES[nextKind]) {
        const base = PIECES[nextKind];
        const piece = { kind: nextKind, color: base.color, cells: base.cells };
        const px = previewX + Math.floor(cell * 1.2);
        const py = previewY + Math.floor(cell * 2.1);
        drawPreviewPiece(piece, px, py, cell);
      }

      if (state.paused) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    function drawPiece(piece, px, py, cell, offX, offY, ghost) {
      const m = piece.cells;
      for (let y = 0; y < m.length; y += 1) {
        for (let x = 0; x < m[y].length; x += 1) {
          if (!m[y][x]) continue;
          const bx = px + x;
          const by = py + y;
          if (by < 0) continue;
          const color = ghost ? "rgba(255,255,255,0.14)" : piece.color;
          drawCell(offX + bx * cell, offY + by * cell, cell, color);
        }
      }
    }

    function drawPreviewPiece(piece, x0, y0, cell) {
      const m = piece.cells;
      const width = m[0].length;
      const height = m.length;
      const px = x0 + Math.floor((cell * 4 - width * cell) / 2);
      const py = y0 + Math.floor((cell * 4 - height * cell) / 2);

      for (let y = 0; y < m.length; y += 1) {
        for (let x = 0; x < m[y].length; x += 1) {
          if (!m[y][x]) continue;
          drawCell(px + x * cell, py + y * cell, cell, piece.color);
        }
      }
    }

    function refillBag() {
      const bag = [...BAG];
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = randInt(0, i);
        const t = bag[i];
        bag[i] = bag[j];
        bag[j] = t;
      }
      return bag;
    }

    function nextFromQueue() {
      if (!state.queue.length) state.queue = refillBag();
      const kind = state.queue.shift();
      const base = PIECES[kind];
      return { kind, color: base.color, cells: base.cells.map((r) => r.slice()) };
    }

    function spawn() {
      state.active = nextFromQueue();
      state.ax = Math.floor(COLS / 2) - 2;
      state.ay = -2;

      if (state.active.kind === "O") state.ax = Math.floor(COLS / 2) - 1;

      if (collides(state.board, state.active, state.ax, state.ay)) {
        gameOver();
      }
    }

    function updateScore(lines) {
      if (!lines) return;
      const linePoints = [0, 100, 300, 500, 800];
      state.lines += lines;
      state.score += linePoints[lines] * (state.level + 1);
      scoreEl.textContent = String(state.score);

      const nextLevelAt = (state.level + 1) * 10;
      if (state.lines >= nextLevelAt) {
        state.level += 1;
      }
    }

    function getDropIntervalMs() {
      const base = 800;
      const min = 90;
      return Math.max(min, base - state.level * 55);
    }

    function lock() {
      const m = state.active.cells;
      for (let y = 0; y < m.length; y += 1) {
        for (let x = 0; x < m[y].length; x += 1) {
          if (!m[y][x]) continue;
          const by = state.ay + y;
          if (by < 0) {
            gameOver();
            return;
          }
        }
      }

      merge(state.board, state.active, state.ax, state.ay);
      sfxLock();
      const cleared = clearLines(state.board);
      if (cleared) {
        sfxLineClear(cleared);
        updateScore(cleared);
      }
      spawn();
    }

    function tryMove(dx, dy) {
      if (!state.active) return false;
      const nx = state.ax + dx;
      const ny = state.ay + dy;
      if (!collides(state.board, state.active, nx, ny)) {
        state.ax = nx;
        state.ay = ny;
        return true;
      }
      return false;
    }

    function tryRotate() {
      if (!state.active) return;
      if (state.active.kind === "O") return;

      const rotated = rotateCW(state.active.cells);
      const kicks = [
        { x: 0, y: 0 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: -2, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: -1 },
      ];

      for (let i = 0; i < kicks.length; i += 1) {
        const k = kicks[i];
        const nx = state.ax + k.x;
        const ny = state.ay + k.y;
        const testPiece = { ...state.active, cells: rotated };
        if (!collides(state.board, testPiece, nx, ny)) {
          state.active = testPiece;
          state.ax = nx;
          state.ay = ny;
          sfxRotate();
          return;
        }
      }
    }

    function getHardDropY() {
      let y = state.ay;
      while (!collides(state.board, state.active, state.ax, y + 1)) y += 1;
      return y;
    }

    function hardDrop() {
      if (!state.active) return;
      state.ay = getHardDropY();
      sfxDrop();
      lock();
    }

    function softDrop() {
      if (!tryMove(0, 1)) {
        lock();
      }
    }

    function gameOver() {
      state.running = false;
      state.paused = false;

      if (state.score > state.best) {
        state.best = state.score;
        setBestScore(state.best);
      }

      bestEl.textContent = String(state.best);
      sfxGameOver();
      showOverlay("Game Over", "Press R to restart (Esc for menu)");
    }

    function resetState() {
      state = {
        board: makeBoard(),
        queue: refillBag(),
        active: null,
        ax: 0,
        ay: 0,
        score: 0,
        best: getBestScore(),
        lines: 0,
        level: 0,
        running: true,
        paused: false,
        lastDropTs: 0,
      };

      scoreEl.textContent = String(state.score);
      bestEl.textContent = String(state.best);
      hideOverlay();

      spawn();
      draw(performance.now());
    }

    function togglePause() {
      if (!state?.running) return;
      state.paused = !state.paused;
      if (state.paused) showOverlay("Paused", "Press P to resume");
      else {
        hideOverlay();
        state.lastDropTs = performance.now();
      }
    }

    function loop(ts) {
      if (!state) return;
      if (!state.running) {
        draw(ts);
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (!state.lastDropTs) state.lastDropTs = ts;

      if (!state.paused) {
        const interval = getDropIntervalMs();
        if (ts - state.lastDropTs >= interval) {
          softDrop();
          state.lastDropTs = ts;
        }
      }

      draw(ts);
      rafId = requestAnimationFrame(loop);
    }

    function attachListeners() {
      if (runningAttached) return;
      runningAttached = true;

      keydownHandler = (e) => {
        ensureAudio();
        resumeAudioIfNeeded();

        const key = e.key.toLowerCase();

        if (key === "m") {
          toggleMuted();
          return;
        }

        if (key === "r") {
          resetState();
          return;
        }

        if (key === "p") {
          e.preventDefault();
          togglePause();
          return;
        }

        if (!state || !state.running || state.paused) return;

        if (key === "arrowleft" || key === "a") {
          e.preventDefault();
          if (tryMove(-1, 0)) sfxMove();
          return;
        }

        if (key === "arrowright" || key === "d") {
          e.preventDefault();
          if (tryMove(1, 0)) sfxMove();
          return;
        }

        if (key === "arrowdown" || key === "s") {
          e.preventDefault();
          softDrop();
          return;
        }

        if (key === "arrowup" || key === "w") {
          e.preventDefault();
          tryRotate();
          return;
        }

        if (key === " ") {
          e.preventDefault();
          hardDrop();
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

    let state;

    function start({
      canvas: c,
      scoreEl: s,
      bestEl: b,
      overlayEl: o,
      overlayTitleEl: ot,
      overlaySubtitleEl: os,
    }) {
      canvas = c;
      ctx = canvas.getContext("2d");

      scoreEl = s;
      bestEl = b;

      overlayEl = o;
      overlayTitleEl = ot;
      overlaySubtitleEl = os;

      attachListeners();
      resetState();
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      detachListeners();
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

  window.TetrisGame = createTetrisGame();
})();
