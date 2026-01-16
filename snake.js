(() => {
  function createSnakeGame() {
    // Snake game module.
    // The outside world interacts through start()/stop() and mute helpers.
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

  const GRID_SIZE = 24;
  let CELL = 20;

  const INITIAL_SPEED_MS = 120;
  const MIN_SPEED_MS = 60;
  const SPEEDUP_EVERY = 5;

  const FOOD_MOVE_MS = 1260;

  const STORAGE_KEY = "snake_best_score";

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
      master.gain.value = 0.6;
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
    if (audioState.master) {
      audioState.master.gain.value = muted ? 0 : 0.6;
    }
  }

  function toggleMuted() {
    setMuted(!audioState.muted);
  }

  function playTone({
    type,
    freq,
    durationMs,
    startGain,
    endGain,
    attackMs,
    releaseMs,
    detune,
  }) {
    if (!ensureAudio()) return;
    resumeAudioIfNeeded();
    if (audioState.muted) return;

    const ctx = audioState.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (typeof detune === "number") {
      osc.detune.setValueAtTime(detune, ctx.currentTime);
    }

    const now = ctx.currentTime;
    const attack = Math.max(0.001, (attackMs ?? 4) / 1000);
    const release = Math.max(0.001, (releaseMs ?? 40) / 1000);
    const dur = Math.max(0.02, durationMs / 1000);
    const peak = startGain ?? 0.25;
    const end = endGain ?? 0.0001;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(end, now + Math.max(attack + 0.001, dur - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(audioState.master);

    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function playEatSound() {
    playTone({
      type: "sine",
      freq: 880,
      durationMs: 80,
      startGain: 0.2,
      attackMs: 3,
      releaseMs: 40,
    });
    if (!audioState.ctx || audioState.muted) return;
    const ctx = audioState.ctx;
    const t = ctx.currentTime + 0.05;
    playTone({
      type: "triangle",
      freq: 1320,
      durationMs: 90,
      startGain: 0.16,
      attackMs: 2,
      releaseMs: 55,
      detune: 6,
    });
  }

  function playDieSound() {
    if (!ensureAudio()) return;
    resumeAudioIfNeeded();
    if (audioState.muted) return;

    const ctx = audioState.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    gain.connect(audioState.master);

    osc.start(now);
    osc.stop(now + 0.25);

    playTone({
      type: "square",
      freq: 90,
      durationMs: 120,
      startGain: 0.12,
      attackMs: 1,
      releaseMs: 80,
      detune: -12,
    });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function randInt(min, maxInclusive) {
    return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
  }

  function samePos(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function posKey(p) {
    return `${p.x},${p.y}`;
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

  function getBestScore() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  function setBestScore(value) {
    localStorage.setItem(STORAGE_KEY, String(value));
  }

  // The game state object. This holds all the game's state, including:
  // - snake position
  // - direction
  // - food position
  // - score
  // - lives
  // - game over state
  let state;

  // Update the HUD lives display. We keep this in one place so:
  // - snake can update it after collisions
  // - reset can initialize it
  // - stop can clear state and the UI can fall back to '-'
  function updateLivesUi() {
    if (!livesEl) return;
    livesEl.textContent = state ? String(state.lives) : "-";
  }

  // Respawn logic for continuing after a collision.
  // This intentionally keeps score/best but resets snake position/speed/food.
  function resetSnakePosition() {
    const mid = Math.floor(GRID_SIZE / 2);
    state.snake = [
      { x: mid + 1, y: mid },
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
    ];
    state.dir = { x: 1, y: 0 };
    state.queuedDir = { x: 1, y: 0 };
    state.tickMs = INITIAL_SPEED_MS;
    state.lastStepTs = 0;
    state.particles = [];
    state.food = spawnFood();
    state.foodDir = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }][
      randInt(0, 3)
    ];
    state.lastFoodMoveTs = performance.now();
  }

  function resetState() {
    // Full reset used by start() and R-key restart.
    // This resets score, speed and also restores lives back to 3.
    state = {
      snake: [],
      dir: { x: 1, y: 0 },
      queuedDir: { x: 1, y: 0 },
      foodDir: { x: 0, y: 0 },
      lastFoodMoveTs: 0,
      food: null,
      particles: [],
      score: 0,
      best: getBestScore(),
      // Lives are tracked at the game state level (not per snake segment).
      lives: 3,
      running: true,
      paused: false,
      bgHue: randInt(0, 359),
      tickMs: INITIAL_SPEED_MS,
      lastStepTs: 0,
    };

    resetSnakePosition();
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(state.best);
    updateLivesUi();
    hideOverlay();
    draw(performance.now());
  }

  function loseLife(reason) {
    // Called when the snake hits a wall or itself.
    // - decrement lives
    // - if any remain: show a short overlay and respawn
    // - else: transition to full gameOver()
    if (!state.running) return;

    playDieSound();

    state.lives = Math.max(0, state.lives - 1);
    updateLivesUi();

    if (state.lives <= 0) {
      gameOver();
      return;
    }

    state.running = true;
    state.paused = false;

    showOverlay("Life lost", `Lives left: ${state.lives}`);
    if (lifeLostTimeoutId) window.clearTimeout(lifeLostTimeoutId);
    lifeLostTimeoutId = window.setTimeout(() => {
      lifeLostTimeoutId = null;
      if (state && state.running && !state.paused) hideOverlay();
    }, 800);

    resetSnakePosition();
  }

  function eatFoodAt(pos) {
    state.score += 1;
    scoreEl.textContent = String(state.score);

    playEatSound();

    spawnExplosion(pos);
    state.bgHue = (state.bgHue + randInt(25, 90)) % 360;

    if (state.score % SPEEDUP_EVERY === 0) {
      state.tickMs = Math.max(MIN_SPEED_MS, state.tickMs - 7);
    }

    state.food = spawnFood();
    state.foodDir = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }][
      randInt(0, 3)
    ];
    state.lastFoodMoveTs = performance.now();
  }

  function spawnFood() {
    const occupied = new Set(state.snake.map(posKey));

    for (let i = 0; i < 2000; i += 1) {
      const p = { x: randInt(0, GRID_SIZE - 1), y: randInt(0, GRID_SIZE - 1) };
      if (!occupied.has(posKey(p))) return p;
    }

    return { x: 0, y: 0 };
  }

  function isOpposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  function queueDirection(next) {
    if (!state.running) return;
    if (state.paused) return;
    if (isOpposite(next, state.dir)) return;
    state.queuedDir = next;
  }

  function gameOver() {
    state.running = false;
    state.paused = false;

    if (state.score > state.best) {
      state.best = state.score;
      setBestScore(state.best);
    }

    bestEl.textContent = String(state.best);
    showOverlay("Game Over", "Press R to restart");
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    if (state.paused) {
      showOverlay("Paused", "Press Space to resume");
    } else {
      hideOverlay();
      state.lastStepTs = performance.now();
    }
  }

  function showOverlay(title, subtitle) {
    overlayTitleEl.textContent = title;
    overlaySubtitleEl.textContent = subtitle;
    overlayEl.hidden = false;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
  }

  function step() {
    // One snake tick.
    // Movement direction is queued by keyboard input, then applied here.
    state.dir = state.queuedDir;

    const head = state.snake[0];
    const nextHead = {
      x: head.x + state.dir.x,
      y: head.y + state.dir.y,
    };

    if (
      nextHead.x < 0 ||
      nextHead.x >= GRID_SIZE ||
      nextHead.y < 0 ||
      nextHead.y >= GRID_SIZE
    ) {
      // Wall collision -> lose a life.
      loseLife("wall");
      return;
    }

    for (let i = 0; i < state.snake.length; i += 1) {
      if (samePos(state.snake[i], nextHead)) {
        // Self collision -> lose a life.
        loseLife("self");
        return;
      }
    }

    state.snake.unshift(nextHead);

    if (samePos(nextHead, state.food)) {
      eatFoodAt(state.food);
    } else {
      state.snake.pop();
    }
  }

  function moveFoodOnce() {
    if (!state.running || state.paused) return;
    if (!state.food) return;

    const occupied = new Set(state.snake.map(posKey));
    const dirs = [
      state.foodDir,
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    const candidates = [];
    for (let i = 0; i < dirs.length; i += 1) {
      const d = dirs[i];
      const np = { x: state.food.x + d.x, y: state.food.y + d.y };
      if (np.x < 0 || np.x >= GRID_SIZE || np.y < 0 || np.y >= GRID_SIZE) continue;
      if (occupied.has(posKey(np))) continue;
      candidates.push({ np, d });
    }

    if (!candidates.length) return;

    const pick = candidates[randInt(0, candidates.length - 1)];
    state.food = pick.np;
    state.foodDir = pick.d;

    if (samePos(state.food, state.snake[0])) {
      eatFoodAt(state.food);
    }
  }

  function drawBackground() {
    const w = canvas.width;
    const h = canvas.height;

    const hue = typeof state?.bgHue === "number" ? state.bgHue : 210;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `hsl(${hue} 55% 14%)`);
    grad.addColorStop(1, `hsl(${hue} 60% 6%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "#d0e6ff";
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_SIZE; i += 1) {
      const p = i * CELL;
      ctx.beginPath();
      ctx.moveTo(p + 0.5, 0);
      ctx.lineTo(p + 0.5, h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p + 0.5);
      ctx.lineTo(w, p + 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawFood() {
    const cx = state.food.x * CELL + CELL / 2;
    const cy = state.food.y * CELL + CELL / 2;
    const fontSize = Math.floor(CELL * 0.82);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI Emoji, Apple Color Emoji`;

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000000";
    ctx.fillText("🍎", cx + 1, cy + 2);

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("🍎", cx, cy);
    ctx.restore();
  }

  function spawnExplosion(foodPos) {
    const cx = foodPos.x * CELL + CELL / 2;
    const cy = foodPos.y * CELL + CELL / 2;
    const now = performance.now();

    const count = 16;
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
      const speed = randInt(70, 170);
      state.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: randInt(2, 4),
        born: now,
        life: randInt(220, 340),
        hue: (state.bgHue + randInt(-20, 20) + 360) % 360,
      });
    }
  }

  function updateParticles(ts) {
    if (!state?.particles?.length) return;
    const dt = Math.min(0.05, (ts - (state.lastParticleTs || ts)) / 1000);
    state.lastParticleTs = ts;

    const drag = 0.92;
    const gravity = 420;

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      const age = ts - p.born;
      if (age >= p.life) {
        state.particles.splice(i, 1);
        continue;
      }

      p.vx *= Math.pow(drag, dt * 60);
      p.vy = p.vy * Math.pow(drag, dt * 60) + gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function drawParticles(ts) {
    if (!state?.particles?.length) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < state.particles.length; i += 1) {
      const p = state.particles[i];
      const age = ts - p.born;
      const t = clamp(age / p.life, 0, 1);
      const alpha = (1 - t) * 0.9;

      ctx.globalAlpha = alpha;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2);
      grad.addColorStop(0, `hsla(${p.hue} 95% 70% / 1)`);
      grad.addColorStop(1, `hsla(${p.hue} 95% 55% / 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSnake() {
    for (let i = 0; i < state.snake.length; i += 1) {
      const seg = state.snake[i];
      const isHead = i === 0;

      const pad = isHead ? 3 : 4;
      const x = seg.x * CELL + pad;
      const y = seg.y * CELL + pad;
      const size = CELL - pad * 2;

      const base = isHead ? "#5bffbf" : "#2eea9a";
      ctx.fillStyle = base;

      drawRoundedRect(x, y, size, size, isHead ? 8 : 7);
      ctx.fill();

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#000000";
      drawRoundedRect(x + 1, y + 1, size, size, isHead ? 8 : 7);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isHead) {
        const eyeSize = Math.max(2, Math.floor(size * 0.18));
        const eyeOffset = Math.floor(size * 0.2);
        ctx.fillStyle = "rgba(0,0,0,0.75)";

        const ex1 = x + eyeOffset;
        const ex2 = x + size - eyeOffset - eyeSize;
        const ey = y + eyeOffset;
        ctx.fillRect(ex1, ey, eyeSize, eyeSize);
        ctx.fillRect(ex2, ey, eyeSize, eyeSize);
      }
    }
  }

  function draw(ts) {
    drawBackground();
    drawFood();
    drawSnake();
    drawParticles(ts ?? performance.now());
  }

  function loop(ts) {
    if (!state) return;

    updateParticles(ts);

    if (state.running && !state.paused) {
      if (!state.lastStepTs) state.lastStepTs = ts;
      const elapsed = ts - state.lastStepTs;

      if (elapsed >= state.tickMs) {
        const steps = Math.min(5, Math.floor(elapsed / state.tickMs));
        for (let i = 0; i < steps; i += 1) {
          step();
          if (!state.running) break;
        }
        state.lastStepTs = ts;
      }

      if (!state.lastFoodMoveTs) state.lastFoodMoveTs = ts;
      if (ts - state.lastFoodMoveTs >= FOOD_MOVE_MS) {
        const foodSteps = Math.min(3, Math.floor((ts - state.lastFoodMoveTs) / FOOD_MOVE_MS));
        for (let i = 0; i < foodSteps; i += 1) moveFoodOnce();
        state.lastFoodMoveTs = ts;
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

      if (key === " " || key === "spacebar") {
        e.preventDefault();
        togglePause();
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
        queueDirection({ x: 0, y: -1 });
        return;
      }

      if (key === "arrowdown" || key === "s") {
        e.preventDefault();
        queueDirection({ x: 0, y: 1 });
        return;
      }

      if (key === "arrowleft" || key === "a") {
        e.preventDefault();
        queueDirection({ x: -1, y: 0 });
        return;
      }

      if (key === "arrowright" || key === "d") {
        e.preventDefault();
        queueDirection({ x: 1, y: 0 });
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
    CELL = Math.floor(canvas.width / GRID_SIZE);

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

  function toggleMutedExternal() {
    toggleMuted();
  }

  return {
    start,
    stop,
    setMuted: setMutedExternal,
    toggleMuted: toggleMutedExternal,
  };
  }

  window.SnakeGame = createSnakeGame();
})();
