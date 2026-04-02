/**
 * 贪吃蛇 — 原生 JS 模块化结构
 * 职责：配置常量、DOM 引用、游戏状态、各功能函数、事件绑定
 */

(function () {
  "use strict";

  // ---------- 配置 ----------
  const GRID_SIZE = 20;
  const CELL_PX = 20;
  const CANVAS_PX = GRID_SIZE * CELL_PX;
  /** 基础移动间隔（毫秒），数值越小越快 */
  const BASE_TICK_MS = 140;
  /** 每得多少分，间隔减少多少毫秒（有下限） */
  const SPEED_STEP_SCORE = 5;
  const SPEED_MS_REDUCTION = 4;
  const MIN_TICK_MS = 65;
  const ABS_MIN_TICK_MS = 42;
  const HIGH_SCORE_KEY = "snake_high_score_v1";
  const SPEED_LEVEL_KEY = "snake_speed_level_v1";
  /** 速度档位：在基础间隔上叠加的毫秒数（越大越慢） */
  const SPEED_LEVEL_MS = [55, 28, 0, -28, -52];
  const SPEED_LEVEL_LABELS = ["很慢", "慢", "标准", "快", "很快"];

  const DIRECTION = {
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  };

  /** @type {{ x: number, y: number }[]} */
  let snake = [];
  /** @type {{ x: number, y: number }} */
  let food = { x: 0, y: 0 };
  /** 当前移动方向 */
  let dir = DIRECTION.RIGHT;
  /** 下一帧将要应用的方向（防同帧多次按键） */
  let nextDir = DIRECTION.RIGHT;
  let score = 0;
  let gameRunning = false;
  let paused = false;
  let tickTimer = null;
  /** 0 ~ SPEED_LEVEL_MS.length-1，越大越快（间隔越短） */
  let speedLevel = 2;

  // ---------- DOM ----------
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const elScore = document.getElementById("score");
  const elHighScore = document.getElementById("high-score");
  const btnStart = document.getElementById("btn-start");
  const btnPause = document.getElementById("btn-pause");
  const btnRestart = document.getElementById("btn-restart");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMessage = document.getElementById("overlay-message");
  const overlayRestart = document.getElementById("overlay-restart");
  const touchPad = document.getElementById("touch-pad");
  const btnSpeedDown = document.getElementById("btn-speed-down");
  const btnSpeedUp = document.getElementById("btn-speed-up");
  const elSpeedLabel = document.getElementById("speed-label");

  // ---------- 工具 ----------
  function isOpposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getTickIntervalMs() {
    const bonus = Math.floor(score / SPEED_STEP_SCORE) * SPEED_MS_REDUCTION;
    const base = Math.max(MIN_TICK_MS, BASE_TICK_MS - bonus);
    const delta = SPEED_LEVEL_MS[speedLevel] ?? 0;
    return Math.max(ABS_MIN_TICK_MS, base + delta);
  }

  function loadSpeedLevel() {
    const raw = localStorage.getItem(SPEED_LEVEL_KEY);
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n < SPEED_LEVEL_MS.length) {
      speedLevel = n;
    } else {
      speedLevel = 2;
    }
  }

  function saveSpeedLevel() {
    localStorage.setItem(SPEED_LEVEL_KEY, String(speedLevel));
  }

  /** 更新速度按钮与文案 */
  function updateSpeedControls() {
    if (elSpeedLabel) {
      elSpeedLabel.textContent = SPEED_LEVEL_LABELS[speedLevel] ?? "标准";
    }
    if (btnSpeedDown) btnSpeedDown.disabled = speedLevel <= 0;
    if (btnSpeedUp) btnSpeedUp.disabled = speedLevel >= SPEED_LEVEL_MS.length - 1;
  }

  /** 游戏中调整速度时重设定时器 */
  function applySpeedChange() {
    saveSpeedLevel();
    updateSpeedControls();
    if (gameRunning && !paused) {
      restartTickWithNewSpeed();
    }
  }

  // ---------- 最高分（localStorage） ----------
  function loadHighScore() {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function saveHighScoreIfNeeded() {
    const prev = loadHighScore();
    if (score > prev) {
      localStorage.setItem(HIGH_SCORE_KEY, String(score));
    }
    updateScoreDisplay();
  }

  // ---------- 初始化游戏 ----------
  function initGame() {
    const mid = Math.floor(GRID_SIZE / 2);
    snake = [
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
      { x: mid - 3, y: mid },
    ];
    dir = DIRECTION.RIGHT;
    nextDir = DIRECTION.RIGHT;
    score = 0;
    spawnFood();
    updateScoreDisplay();
    drawBoard();
  }

  // ---------- 绘制棋盘（网格 + 蛇 + 食物） ----------
  function drawBoard() {
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // 网格线
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const p = i * CELL_PX;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, CANVAS_PX);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(CANVAS_PX, p);
      ctx.stroke();
    }

    // 食物
    ctx.fillStyle = "#fca5a5";
    roundRect(
      ctx,
      food.x * CELL_PX + 2,
      food.y * CELL_PX + 2,
      CELL_PX - 4,
      CELL_PX - 4,
      4
    );
    ctx.fill();

    // 蛇身（不含头部，头部单独绘制以更形象）
    for (let i = 1; i < snake.length; i++) {
      const seg = snake[i];
      ctx.fillStyle = "#5eead4";
      roundRect(
        ctx,
        seg.x * CELL_PX + 2,
        seg.y * CELL_PX + 2,
        CELL_PX - 4,
        CELL_PX - 4,
        4
      );
      ctx.fill();
    }

    if (snake.length > 0) {
      drawSnakeHead(snake[0], dir);
    }
  }

  /**
   * 绘制蛇头：略大的圆角矩形 + 朝向当前移动方向的眼睛（眼白 + 瞳孔）
   * @param {{ x: number, y: number }} head
   * @param {{ x: number, y: number }} faceDir 当前朝向（与 dir 一致）
   */
  function drawSnakeHead(head, faceDir) {
    const px = head.x * CELL_PX;
    const py = head.y * CELL_PX;
    const pad = 0.5;
    const w = CELL_PX - pad * 2;
    const h = CELL_PX - pad * 2;

    const gx = px + pad;
    const gy = py + pad;

    const headGrad = ctx.createLinearGradient(gx, gy, gx + w, gy + h);
    headGrad.addColorStop(0, "#5eead4");
    headGrad.addColorStop(0.45, "#2dd4bf");
    headGrad.addColorStop(1, "#0d9488");
    ctx.fillStyle = headGrad;
    roundRect(ctx, gx, gy, w, h, 6);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.25;
    roundRect(ctx, gx, gy, w, h, 6);
    ctx.stroke();

    const cx = gx + w / 2;
    const cy = gy + h / 2;
    const eyeR = 3.2;
    const pupilR = 1.6;
    let e1x;
    let e1y;
    let e2x;
    let e2y;

    if (faceDir === DIRECTION.RIGHT) {
      e1x = cx + 3.5;
      e1y = cy - 4;
      e2x = cx + 3.5;
      e2y = cy + 4;
    } else if (faceDir === DIRECTION.LEFT) {
      e1x = cx - 3.5;
      e1y = cy - 4;
      e2x = cx - 3.5;
      e2y = cy + 4;
    } else if (faceDir === DIRECTION.UP) {
      e1x = cx - 4;
      e1y = cy - 3.5;
      e2x = cx + 4;
      e2y = cy - 3.5;
    } else {
      e1x = cx - 4;
      e1y = cy + 3.5;
      e2x = cx + 4;
      e2y = cy + 3.5;
    }

    function drawEye(ex, ey, towardX, towardY) {
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(ex + towardX, ey + towardY, pupilR, 0, Math.PI * 2);
      ctx.fill();
    }

    const look = 1.1;
    if (faceDir === DIRECTION.RIGHT) {
      drawEye(e1x, e1y, look, 0);
      drawEye(e2x, e2y, look, 0);
    } else if (faceDir === DIRECTION.LEFT) {
      drawEye(e1x, e1y, -look, 0);
      drawEye(e2x, e2y, -look, 0);
    } else if (faceDir === DIRECTION.UP) {
      drawEye(e1x, e1y, 0, -look);
      drawEye(e2x, e2y, 0, -look);
    } else {
      drawEye(e1x, e1y, 0, look);
      drawEye(e2x, e2y, 0, look);
    }
  }

  /** 圆角矩形填充（兼容旧浏览器可改为 rect） */
  function roundRect(context, x, y, w, h, r) {
    if (typeof context.roundRect === "function") {
      context.beginPath();
      context.roundRect(x, y, w, h, r);
      return;
    }
    const rr = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + rr, y);
    context.arcTo(x + w, y, x + w, y + h, rr);
    context.arcTo(x + w, y + h, x, y + h, rr);
    context.arcTo(x, y + h, x, y, rr);
    context.arcTo(x, y, x + w, y, rr);
    context.closePath();
  }

  // ---------- 生成食物（不在蛇身上） ----------
  function spawnFood() {
    let nx;
    let ny;
    let safe = false;
    let guard = 0;
    while (!safe && guard < 500) {
      guard++;
      nx = randomInt(0, GRID_SIZE - 1);
      ny = randomInt(0, GRID_SIZE - 1);
      safe = !snake.some((s) => s.x === nx && s.y === ny);
    }
    food = { x: nx, y: ny };
  }

  // ---------- 碰撞检测 ----------
  function checkWallCollision(head) {
    return head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE;
  }

  function checkSelfCollision(head) {
    return snake.some((seg, i) => i > 0 && seg.x === head.x && seg.y === head.y);
  }

  // ---------- 蛇移动 ----------
  function moveSnake() {
    nextDir = isOpposite(dir, nextDir) ? dir : nextDir;
    dir = nextDir;

    const head = snake[0];
    const newHead = {
      x: head.x + dir.x,
      y: head.y + dir.y,
    };

    if (checkWallCollision(newHead) || checkSelfCollision(newHead)) {
      handleGameOver();
      return;
    }

    snake.unshift(newHead);

    if (newHead.x === food.x && newHead.y === food.y) {
      score += 1;
      updateScoreDisplay();
      spawnFood();
      restartTickWithNewSpeed();
    } else {
      snake.pop();
    }

    drawBoard();
  }

  // ---------- 更新分数 ----------
  function updateScoreDisplay() {
    elScore.textContent = String(score);
    elHighScore.textContent = String(Math.max(loadHighScore(), score));
  }

  // ---------- 游戏结束 ----------
  function handleGameOver() {
    gameRunning = false;
    paused = false;
    clearTick();
    saveHighScoreIfNeeded();
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnPause.textContent = "暂停";
    overlayTitle.textContent = "游戏结束";
    overlayMessage.textContent = `本次得分：${score}。点击按钮再来一局！`;
    overlay.classList.remove("hidden");
  }

  // ---------- 定时器（速度随分数变化） ----------
  function clearTick() {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function restartTickWithNewSpeed() {
    if (!gameRunning || paused) return;
    clearTick();
    tickTimer = setInterval(moveSnake, getTickIntervalMs());
  }

  function startTick() {
    clearTick();
    tickTimer = setInterval(moveSnake, getTickIntervalMs());
  }

  // ---------- 重开游戏 ----------
  function restartGame() {
    overlay.classList.add("hidden");
    clearTick();
    initGame();
    gameRunning = true;
    paused = false;
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnPause.textContent = "暂停";
    startTick();
  }

  function pauseToggle() {
    if (!gameRunning) return;
    paused = !paused;
    if (paused) {
      clearTick();
      btnPause.textContent = "继续";
    } else {
      btnPause.textContent = "暂停";
      startTick();
    }
  }

  // ---------- 键盘：方向键 + WASD + 空格暂停 ----------
  function onKeyDown(e) {
    const key = e.key;
    const map = {
      ArrowUp: DIRECTION.UP,
      ArrowDown: DIRECTION.DOWN,
      ArrowLeft: DIRECTION.LEFT,
      ArrowRight: DIRECTION.RIGHT,
      w: DIRECTION.UP,
      W: DIRECTION.UP,
      s: DIRECTION.DOWN,
      S: DIRECTION.DOWN,
      a: DIRECTION.LEFT,
      A: DIRECTION.LEFT,
      d: DIRECTION.RIGHT,
      D: DIRECTION.RIGHT,
    };

    if (key === " " || key === "Spacebar") {
      e.preventDefault();
      if (gameRunning) pauseToggle();
      return;
    }

    const nd = map[key];
    if (!nd) return;
    e.preventDefault();
    if (!gameRunning || paused) return;
    if (!isOpposite(dir, nd)) nextDir = nd;
  }

  // ---------- 触摸按钮方向 ----------
  function bindTouchPad() {
    if (!touchPad) return;
    const dirMap = {
      up: DIRECTION.UP,
      down: DIRECTION.DOWN,
      left: DIRECTION.LEFT,
      right: DIRECTION.RIGHT,
    };
    touchPad.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-dir");
        const nd = dirMap[name];
        if (!nd || !gameRunning || paused) return;
        if (!isOpposite(dir, nd)) nextDir = nd;
      });
    });
  }

  // ---------- 入口：首次加载 ----------
  function bootstrap() {
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    elHighScore.textContent = String(loadHighScore());
    loadSpeedLevel();
    updateSpeedControls();
    initGame();
    drawBoard();

    btnStart.addEventListener("click", () => {
      if (gameRunning && !paused) return;
      restartGame();
    });

    btnRestart.addEventListener("click", () => {
      restartGame();
    });

    btnPause.addEventListener("click", () => {
      pauseToggle();
    });

    overlayRestart.addEventListener("click", () => {
      restartGame();
    });

    document.addEventListener("keydown", onKeyDown);
    bindTouchPad();

    if (btnSpeedDown) {
      btnSpeedDown.addEventListener("click", () => {
        if (speedLevel > 0) {
          speedLevel -= 1;
          applySpeedChange();
        }
      });
    }
    if (btnSpeedUp) {
      btnSpeedUp.addEventListener("click", () => {
        if (speedLevel < SPEED_LEVEL_MS.length - 1) {
          speedLevel += 1;
          applySpeedChange();
        }
      });
    }
  }

  bootstrap();
})();
