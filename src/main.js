/**
 * Bootstrap & screen router for Diamond Painting game.
 *
 * Screens:  start → select → game → complete
 *                   ↑                  |
 *                   └──────────────────┘
 */
import { LEVELS }       from './levels.js';
import { Game }         from './game.js';
import { buildLevelGrid, buildPalette, showCompleteScreen } from './ui.js';
import {
  initYandex, loadData, saveData,
  submitScore, showLeaderboard,
  showInterstitial, showRewardedAd,
} from './yandex.js';

// ─── State ────────────────────────────────────────────────────────────────────

let appState = {
  completedLevels: [],
  scores:   {},
  progress: {},
};

let currentGame     = null;
let currentLevelId  = null;
let autoSaveTimer   = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const screens = {
  start:    document.getElementById('screen-start'),
  select:   document.getElementById('screen-select'),
  game:     document.getElementById('screen-game'),
  complete: document.getElementById('screen-complete'),
};

const canvas         = document.getElementById('game-canvas');
const progressFill   = document.getElementById('progress-fill');
const progressText   = document.getElementById('progress-text');
const paletteColors  = document.getElementById('palette-colors');
const levelGrid      = document.getElementById('level-grid');

// ─── Screen helpers ───────────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────

function startLevel(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return;
  currentLevelId = levelId;

  // Destroy any running game
  if (currentGame) { currentGame.destroy(); currentGame = null; }

  // Resize canvas to fill its container
  resizeCanvas();

  // Build palette UI
  buildPalette(
    paletteColors,
    level.palette,
    level.palette[0]?.id,
    id => currentGame?.selectColor(id),
  );

  // Create game engine
  const savedProgress = appState.progress[levelId] ?? null;

  currentGame = new Game(
    canvas,
    level,
    savedProgress,
    // onProgress
    (pct) => {
      progressFill.style.width = pct + '%';
      progressText.textContent = pct + '%';
    },
    // onComplete
    async (score, stars) => {
      clearInterval(autoSaveTimer);

      // Update state
      if (!appState.completedLevels.includes(levelId)) {
        appState.completedLevels.push(levelId);
      }
      const prev = appState.scores[levelId] ?? 0;
      appState.scores[levelId]   = Math.max(prev, score);
      delete appState.progress[levelId];

      await saveData(appState);
      await submitScore(appState.scores[levelId]);

      showCompleteScreen(level, score, stars);
      showScreen('complete');

      // Determine next level button
      const nextLevel = LEVELS.find(l => l.id === levelId + 1);
      document.getElementById('btn-next-level').classList.toggle('hidden', !nextLevel);
    },
  );

  // Auto-save progress every 30 seconds
  autoSaveTimer = setInterval(async () => {
    if (currentGame) {
      appState.progress[levelId] = currentGame.getProgress();
      await saveData(appState);
    }
  }, 30_000);

  showScreen('game');
}

function stopCurrentGame() {
  clearInterval(autoSaveTimer);
  if (currentGame) {
    // Save progress before leaving
    if (currentLevelId !== null) {
      appState.progress[currentLevelId] = currentGame.getProgress();
      saveData(appState);
    }
    currentGame.destroy();
    currentGame    = null;
    currentLevelId = null;
  }
}

// ─── Canvas sizing ────────────────────────────────────────────────────────────

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const w    = wrap.clientWidth  || window.innerWidth;
  const h    = wrap.clientHeight || window.innerHeight - 52 - 80;
  if (currentGame) {
    currentGame.resize(w, h);
  } else {
    canvas.width  = w;
    canvas.height = h;
  }
}

window.addEventListener('resize', resizeCanvas);

// ─── Button wiring ────────────────────────────────────────────────────────────

// Start screen
document.getElementById('btn-play').addEventListener('click', () => {
  buildLevelGrid(levelGrid, appState, (id) => {
    showInterstitial().then(() => startLevel(id));
  });
  showScreen('select');
});

document.getElementById('btn-leaderboard').addEventListener('click', showLeaderboard);

// Level select back
document.getElementById('btn-back-select').addEventListener('click', () => showScreen('start'));

// Game back
document.getElementById('btn-back-game').addEventListener('click', () => {
  stopCurrentGame();
  buildLevelGrid(levelGrid, appState, (id) => {
    showInterstitial().then(() => startLevel(id));
  });
  showScreen('select');
});

// Hint button (rewarded ad → bucket fill)
document.getElementById('btn-hint').addEventListener('click', async () => {
  if (!currentGame) return;
  const rewarded = await showRewardedAd();
  if (rewarded) {
    currentGame.bucketFill();
  }
});

// Complete screen
document.getElementById('btn-next-level').addEventListener('click', () => {
  const next = LEVELS.find(l => l.id === currentLevelId + 1);
  if (next) {
    showInterstitial().then(() => startLevel(next.id));
  }
});

document.getElementById('btn-back-select2').addEventListener('click', () => {
  buildLevelGrid(levelGrid, appState, (id) => {
    showInterstitial().then(() => startLevel(id));
  });
  showScreen('select');
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await initYandex();
  appState = await loadData();
  showScreen('start');
}

init();
