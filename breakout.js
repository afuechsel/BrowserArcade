(() => {
  function createBreakoutGame() {
    // Breakout game module.
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
    let keyupHandler;
    let pointerdownHandler;

    const STORAGE_KEY = "breakout_best_score";

    const COLORS = {
      bg: "#070a10",
      paddle: "#e8eef6",
      ball: "#ffd200",
      brickStroke: "rgba(255,255,255,0.15)",
    };

    const PADDLE_W = 84;
    const PADDLE_H = 12;
    const BALL_R = 6;

    const BRICK_COLS = 10;
    const BRICK_ROWS = 6;
    const BRICK_GAP = 6;
    const BRICK_H = 18;
    const BRICK_TOP = 54;

    const MAX_DT = 1 / 30;

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
        const a = new AudioCtx();
        const master = a.createGain();
        master.gain.value = 0.6;
        master.connect(a.destination);
        audioState = { ctx: a, master, muted: audioState.muted };
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

    function playTone({ type, freq, durationMs, startGain, endGain, attackMs, releaseMs, detune }) {
      if (!ensureAudio()) return;
      resumeAudioIfNeeded();
      if (audioState.muted) return;

      const a = audioState.ctx;
      const osc = a.createOscillator();
      const gain = a.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, a.currentTime);
      if (typeof detune === "number") osc.detune.setValueAtTime(detune, a.currentTime);

      const now = a.currentTime;
      const attack = Math.max(0.001, (attackMs ?? 3) / 1000);
      const release = Math.max(0.001, (releaseMs ?? 45) / 1000);
      const dur = Math.max(0.02, durationMs / 1000);
      const peak = startGain ?? 0.22;
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

    function playPaddleHit() {
      playTone({ type: "triangle", freq: 320, durationMs: 55, startGain: 0.18, attackMs: 2, releaseMs: 35 });
      playTone({ type: "sine", freq: 640, durationMs: 45, startGain: 0.10, attackMs: 1, releaseMs: 28, detune: 5 });
    }

    function playBrickHit() {
      playTone({ type: "square", freq: 780, durationMs: 60, startGain: 0.14, attackMs: 2, releaseMs: 38 });
    }

    function playLoseLife() {
      playTone({ type: "sawtooth", freq: 220, durationMs: 170, startGain: 0.22, attackMs: 2, releaseMs: 140 });
    }

    function playWin() {
      playTone({ type: "sine", freq: 660, durationMs: 80, startGain: 0.12, attackMs: 2, releaseMs: 50 });
      playTone({ type: "sine", freq: 990, durationMs: 110, startGain: 0.14, attackMs: 2, releaseMs: 70, detune: 8 });
    }

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function getBestScore() {
      const raw = localStorage.getItem(STORAGE_KEY);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    }

    function setBestScore(value) {
      localStorage.setItem(STORAGE_KEY, String(value));
    }

    let state;

    function showOverlay(title, subtitle) {
      overlayTitleEl.textContent = title;
      overlaySubtitleEl.textContent = subtitle;
      overlayEl.hidden = false;
    }

    function hideOverlay() {
      overlayEl.hidden = true;
    }

    function updateLivesUi() {
      if (!livesEl) return;
      livesEl.textContent = state ? String(state.lives) : "-";
    }

    function brickColor(row, col) {
      const hue = (210 + row * 26 + col * 6) % 360;
      return `hsl(${hue} 85% 55%)`;
    }

    function buildBricks() {
      const bricks = [];
      const totalGap = (BRICK_COLS - 1) * BRICK_GAP;
      const w = (canvas.width - 48 - totalGap) / BRICK_COLS;
      const startX = (canvas.width - (w * BRICK_COLS + totalGap)) / 2;

      for (let r = 0; r < BRICK_ROWS; r += 1) {
        for (let c = 0; c < BRICK_COLS; c += 1) {
          bricks.push({
            x: startX + c * (w + BRICK_GAP),
            y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
            w,
            h: BRICK_H,
            alive: true,
            color: brickColor(r, c),
          });
        }
      }

      return bricks;
    }

    function resetBallOnPaddle() {
      state.ball.x = state.paddle.x + state.paddle.w / 2;
      state.ball.y = state.paddle.y - state.ball.r - 1;
      state.ball.vx = 0;
      state.ball.vy = 0;
      state.ball.attached = true;
    }

    function resetState() {
      state = {
        running: true,
        paused: false,
        lastTs: 0,

        score: 0,
        best: getBestScore(),
        lives: 3,

        input: {
          left: false,
          right: false,
        },

        paddle: {
          w: PADDLE_W,
          h: PADDLE_H,
          x: canvas.width / 2 - PADDLE_W / 2,
          y: canvas.height - 36,
          speed: 420,
        },

        ball: {
          r: BALL_R,
          x: canvas.width / 2,
          y: canvas.height - 50,
          vx: 0,
          vy: 0,
          speed: 360,
          attached: true,
        },

        bricks: buildBricks(),
      };

      resetBallOnPaddle();

      scoreEl.textContent = String(state.score);
      bestEl.textContent = String(state.best);
      updateLivesUi();
      hideOverlay();
      draw();
    }

    function setPaused(paused) {
      state.paused = paused;
      if (paused) showOverlay("Paused", "Press P to resume");
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

    function loseLife() {
      playLoseLife();

      state.lives = Math.max(0, state.lives - 1);
      updateLivesUi();

      if (state.lives <= 0) {
        gameOver(false);
        return;
      }

      showOverlay("Life lost", `Lives left: ${state.lives}`);
      window.setTimeout(() => {
        if (state && state.running && !state.paused) hideOverlay();
      }, 700);

      resetBallOnPaddle();
    }

    function launchBall() {
      if (!state.ball.attached) return;

      // Launch slightly randomized to avoid perfectly vertical starts.
      const angle = (-Math.PI / 2) + (Math.random() * 0.6 - 0.3);
      state.ball.vx = Math.cos(angle) * state.ball.speed;
      state.ball.vy = Math.sin(angle) * state.ball.speed;
      state.ball.attached = false;

      playTone({ type: "sine", freq: 520, durationMs: 55, startGain: 0.12, attackMs: 2, releaseMs: 35 });
    }

    function circleRectHit(cx, cy, r, rect) {
      const closestX = clamp(cx, rect.x, rect.x + rect.w);
      const closestY = clamp(cy, rect.y, rect.y + rect.h);
      const dx = cx - closestX;
      const dy = cy - closestY;
      return dx * dx + dy * dy <= r * r;
    }

    function step(dt) {
      const p = state.paddle;
      const b = state.ball;

      const dir = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
      p.x = clamp(p.x + dir * p.speed * dt, 10, canvas.width - 10 - p.w);

      if (b.attached) {
        b.x = p.x + p.w / 2;
        b.y = p.y - b.r - 1;
        return;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Walls
      if (b.x - b.r < 0) {
        b.x = b.r;
        b.vx = Math.abs(b.vx);
        playPaddleHit();
      }
      if (b.x + b.r > canvas.width) {
        b.x = canvas.width - b.r;
        b.vx = -Math.abs(b.vx);
        playPaddleHit();
      }
      if (b.y - b.r < 0) {
        b.y = b.r;
        b.vy = Math.abs(b.vy);
        playPaddleHit();
      }

      // Bottom = lose life
      if (b.y - b.r > canvas.height) {
        loseLife();
        return;
      }

      // Paddle
      const paddleRect = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (b.vy > 0 && circleRectHit(b.x, b.y, b.r, paddleRect)) {
        b.y = p.y - b.r - 0.5;

        // Angle depends on where the ball hits the paddle.
        const hit = (b.x - (p.x + p.w / 2)) / (p.w / 2);
        const maxAngle = 0.95;
        const angle = (-Math.PI / 2) + clamp(hit, -1, 1) * maxAngle;

        const speed = Math.max(260, Math.hypot(b.vx, b.vy));
        b.vx = Math.cos(angle) * speed;
        b.vy = Math.sin(angle) * speed;

        playPaddleHit();
      }

      // Bricks
      let aliveCount = 0;
      for (let i = 0; i < state.bricks.length; i += 1) {
        const br = state.bricks[i];
        if (!br.alive) continue;
        aliveCount += 1;

        if (!circleRectHit(b.x, b.y, b.r, br)) continue;

        br.alive = false;
        state.score += 50;
        scoreEl.textContent = String(state.score);

        // Bounce: reflect based on which side we are closer to.
        const prevX = b.x - b.vx * dt;
        const prevY = b.y - b.vy * dt;
        const wasLeft = prevX < br.x;
        const wasRight = prevX > br.x + br.w;
        const wasAbove = prevY < br.y;
        const wasBelow = prevY > br.y + br.h;

        if (wasLeft || wasRight) b.vx *= -1;
        else if (wasAbove || wasBelow) b.vy *= -1;
        else b.vy *= -1;

        playBrickHit();
        break;
      }

      if (aliveCount === 0) {
        playWin();
        gameOver(true);
      }
    }

    function drawBackground() {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, "rgba(90,120,255,0.12)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function draw() {
      drawBackground();

      // Bricks
      for (let i = 0; i < state.bricks.length; i += 1) {
        const br = state.bricks[i];
        if (!br.alive) continue;

        ctx.fillStyle = br.color;
        ctx.fillRect(br.x, br.y, br.w, br.h);

        ctx.strokeStyle = COLORS.brickStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1);
      }

      // Paddle
      ctx.fillStyle = COLORS.paddle;
      ctx.fillRect(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h);

      // Ball
      ctx.fillStyle = COLORS.ball;
      ctx.beginPath();
      ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
      ctx.fill();

      // Simple "ready" hint
      if (state.ball.attached && state.running && !state.paused) {
        ctx.fillStyle = "rgba(232,238,246,0.75)";
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText("Press Space to launch", canvas.width / 2, canvas.height / 2 + 10);
      }
    }

    function loop(ts) {
      if (!state) return;

      // Keep drawing even on game over so the overlay stays visible.
      if (!state.running) {
        draw();
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (!state.lastTs) state.lastTs = ts;
      const dt = clamp((ts - state.lastTs) / 1000, 0, MAX_DT);
      state.lastTs = ts;

      if (!state.paused) step(dt);
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

        if (key === "p") {
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

        if (key === " " || key === "spacebar") {
          e.preventDefault();
          if (!state?.running) return;
          if (!state.paused) launchBall();
          return;
        }

        if (key === "arrowleft" || key === "a") {
          e.preventDefault();
          state.input.left = true;
          return;
        }
        if (key === "arrowright" || key === "d") {
          e.preventDefault();
          state.input.right = true;
        }
      };

      keyupHandler = (e) => {
        const key = e.key.toLowerCase();
        if (key === "arrowleft" || key === "a") state.input.left = false;
        if (key === "arrowright" || key === "d") state.input.right = false;
      };

      pointerdownHandler = () => {
        ensureAudio();
        resumeAudioIfNeeded();
      };

      window.addEventListener("keydown", keydownHandler);
      window.addEventListener("keyup", keyupHandler);
      window.addEventListener("pointerdown", pointerdownHandler, { passive: true });
    }

    function detachListeners() {
      if (!runningAttached) return;
      runningAttached = false;
      window.removeEventListener("keydown", keydownHandler);
      window.removeEventListener("keyup", keyupHandler);
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

  window.BreakoutGame = createBreakoutGame();
})();
