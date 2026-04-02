/**
 * 贪吃蛇 — 核心逻辑（原生 JS，无框架）
 * 结构说明：常量配置 → DOM 引用 → 游戏状态 → 网格初始化 →
 *          输入 / 移动 / 碰撞 / 渲染 → 游戏循环与按钮事件
 */

// ---------- 1. 常量：网格尺寸、速度档位、初始蛇 ----------
const GRID_SIZE = 20;
/**
 * 速度档位：label 用于界面，tickMs 为每步间隔（越小越快）
 * 可在培训时改数值对比「帧率」与难度
 */
const SPEED_PRESETS = [
  { label: "慢", tickMs: 220 },
  { label: "中", tickMs: 140 },
  { label: "快", tickMs: 80 },
];
/** 蛇头朝向对应的 CSS 修饰 class，渲染时需从格子上移除 */
const SNAKE_FACE_CLASSES = [
  "game-board__cell--face-up",
  "game-board__cell--face-down",
  "game-board__cell--face-left",
  "game-board__cell--face-right",
];
/** 初始蛇身长度（含头部） */
const INITIAL_SNAKE_LENGTH = 3;
/** 初始蛇朝右移动 */
const INITIAL_DIRECTION = { dx: 1, dy: 0 };

// ---------- 2. DOM 元素 ----------
const gameBoardEl = document.getElementById("gameBoard");
const scoreDisplayEl = document.getElementById("scoreDisplay");
const gameOverBannerEl = document.getElementById("gameOverBanner");
const btnStart = document.getElementById("btnStart");
const btnRestart = document.getElementById("btnRestart");
const speedButtons = document.querySelectorAll(".btn--speed");

/** 所有格子 DOM，一维数组，索引 = row * GRID_SIZE + col */
let cellElements = [];

// ---------- 3. 游戏状态（一次「会话」内会反复读写）----------
let snakeSegments = [];
let direction = { ...INITIAL_DIRECTION };
/** 下一帧要用的方向，避免同一帧内快速按键导致「反向咬身」 */
let pendingDirection = { ...INITIAL_DIRECTION };
let foodPosition = { x: 0, y: 0 };
let score = 0;
let isRunning = false;
let tickTimerId = null;
/** 当前选中的速度档位索引，对应 SPEED_PRESETS */
let speedPresetIndex = 1;

// ---------- 4. 网格初始化：创建 400 个格子并缓存引用 ----------
function buildGrid() {
  gameBoardEl.innerHTML = "";
  cellElements = [];
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const cell = document.createElement("div");
    cell.className = "game-board__cell";
    cell.setAttribute("role", "gridcell");
    gameBoardEl.appendChild(cell);
    cellElements.push(cell);
  }
}

/** 行列 → 一维索引（左上角为 0,0） */
function cellIndex(col, row) {
  return row * GRID_SIZE + col;
}

function getTickMs() {
  return SPEED_PRESETS[speedPresetIndex].tickMs;
}

/** 根据移动方向为蛇头格子选择「脸朝哪边」的 class，供 CSS 画眼睛和吻部 */
function directionToFaceClass(dir) {
  if (dir.dx === 1) return "game-board__cell--face-right";
  if (dir.dx === -1) return "game-board__cell--face-left";
  if (dir.dy === -1) return "game-board__cell--face-up";
  return "game-board__cell--face-down";
}

/** 速度按钮高亮与 data 同步，便于初学者看出当前档位 */
function updateSpeedButtonStyles() {
  speedButtons.forEach((btn) => {
    const idx = parseInt(btn.getAttribute("data-speed-index"), 10);
    btn.classList.toggle("is-active", idx === speedPresetIndex);
  });
}

// ---------- 5. 蛇与食物的初始摆放 ----------
function resetSnakeToCenter() {
  const midY = Math.floor(GRID_SIZE / 2);
  const midX = Math.floor(GRID_SIZE / 2);
  snakeSegments = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    snakeSegments.push({ x: midX - i, y: midY });
  }
  direction = { ...INITIAL_DIRECTION };
  pendingDirection = { ...INITIAL_DIRECTION };
}

/** 在空位上随机放食物（不能与蛇重叠） */
function spawnFood() {
  const occupied = new Set(snakeSegments.map((s) => `${s.x},${s.y}`));
  let x;
  let y;
  do {
    x = Math.floor(Math.random() * GRID_SIZE);
    y = Math.floor(Math.random() * GRID_SIZE);
  } while (occupied.has(`${x},${y}`));
  foodPosition = { x, y };
}

// ---------- 6. 方向键：只更新 pendingDirection，真正移动在 tick 里 ----------
function isOpposite(a, b) {
  return a.dx === -b.dx && a.dy === -b.dy;
}

function onKeyDown(event) {
  const key = event.key;
  let next = null;
  if (key === "ArrowUp") next = { dx: 0, dy: -1 };
  else if (key === "ArrowDown") next = { dx: 0, dy: 1 };
  else if (key === "ArrowLeft") next = { dx: -1, dy: 0 };
  else if (key === "ArrowRight") next = { dx: 1, dy: 0 };
  if (!next) return;
  event.preventDefault();
  if (!isRunning) return;
  /** 禁止立即反向（否则会立刻撞到自己） */
  if (!isOpposite(next, direction)) {
    pendingDirection = next;
  }
}

// ---------- 7. 单步移动：撞墙、吃食物、撞自己 ----------
function stepGame() {
  direction = { ...pendingDirection };
  const head = snakeSegments[0];
  const newHead = {
    x: head.x + direction.dx,
    y: head.y + direction.dy,
  };

  // 撞墙
  if (
    newHead.x < 0 ||
    newHead.x >= GRID_SIZE ||
    newHead.y < 0 ||
    newHead.y >= GRID_SIZE
  ) {
    endGame();
    return;
  }

  // 撞到自己（新头不能落在现有身体上；注意：传统蛇「尾会移走」时尾格可站，这里先检查不含尾移走的逻辑：新头在蛇身里即死）
  const hitSelf = snakeSegments.some(
    (seg) => seg.x === newHead.x && seg.y === newHead.y
  );
  if (hitSelf) {
    endGame();
    return;
  }

  snakeSegments.unshift(newHead);

  const ateFood =
    newHead.x === foodPosition.x && newHead.y === foodPosition.y;
  if (ateFood) {
    score += 1;
    scoreDisplayEl.textContent = String(score);
    spawnFood();
  } else {
    snakeSegments.pop();
  }

  renderBoard();
}

// ---------- 8. 渲染：根据状态给格子加 / 去 class ----------
function clearCellClasses(cell) {
  cell.classList.remove(
    "game-board__cell--snake",
    "game-board__cell--head",
    "game-board__cell--food",
    ...SNAKE_FACE_CLASSES
  );
}

function renderBoard() {
  for (let i = 0; i < cellElements.length; i++) {
    clearCellClasses(cellElements[i]);
  }
  snakeSegments.forEach((seg, index) => {
    const idx = cellIndex(seg.x, seg.y);
    const cell = cellElements[idx];
    if (!cell) return;
    cell.classList.add("game-board__cell--snake");
    if (index === 0) {
      cell.classList.add("game-board__cell--head");
      cell.classList.add(directionToFaceClass(direction));
    }
  });
  const foodIdx = cellIndex(foodPosition.x, foodPosition.y);
  const foodCell = cellElements[foodIdx];
  if (foodCell) foodCell.classList.add("game-board__cell--food");
}

// ---------- 9. 开始 / 结束 / 重启 ----------
function stopTick() {
  if (tickTimerId !== null) {
    clearInterval(tickTimerId);
    tickTimerId = null;
  }
}

/**
 * 按当前速度启动定时器；若已在跑，会先清掉再建（用于游戏中切换速度）
 */
function applyGameInterval() {
  stopTick();
  tickTimerId = window.setInterval(stepGame, getTickMs());
}

function endGame() {
  isRunning = false;
  stopTick();
  gameOverBannerEl.hidden = false;
  btnStart.disabled = false;
}

function startGame() {
  if (isRunning) return;
  gameOverBannerEl.hidden = true;
  isRunning = true;
  btnStart.disabled = true;
  applyGameInterval();
}

/** 完全重置状态并立即开始新的一局 */
function restartGame() {
  stopTick();
  isRunning = false;
  score = 0;
  scoreDisplayEl.textContent = "0";
  gameOverBannerEl.hidden = true;
  resetSnakeToCenter();
  spawnFood();
  renderBoard();
  startGame();
}

function initGame() {
  buildGrid();
  resetSnakeToCenter();
  spawnFood();
  renderBoard();
  btnStart.disabled = false;
  updateSpeedButtonStyles();
}

// ---------- 10. 事件绑定 ----------
btnStart.addEventListener("click", () => {
  if (isRunning) return;
  /** 若上一局已结束，蛇仍停在失败姿态，需先重置再开新局 */
  if (!gameOverBannerEl.hidden) {
    restartGame();
    return;
  }
  gameOverBannerEl.hidden = true;
  startGame();
});

btnRestart.addEventListener("click", () => {
  restartGame();
});

/** 速度：点击后立即切换档位；若游戏进行中，下一帧间隔立刻生效 */
speedButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = parseInt(btn.getAttribute("data-speed-index"), 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= SPEED_PRESETS.length) return;
    speedPresetIndex = idx;
    updateSpeedButtonStyles();
    if (isRunning) {
      applyGameInterval();
    }
  });
});

window.addEventListener("keydown", onKeyDown);

// ---------- 11. 入口：页面加载后建好网格，等待用户点「开始游戏」----------
initGame();
