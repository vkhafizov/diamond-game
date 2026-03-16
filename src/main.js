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
import { initAurora, pauseAurora, resumeAurora } from './aurora.js';
import { startAmbientDrone, playLevelComplete } from './audio.js';

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

// Screen transition directions: from → to → class
const TRANSITION_DIR = {
  'start→select':   'entering-from-right',
  'select→game':    'entering-from-right',
  'game→select':    'entering-from-left',
  'complete→select':'entering-from-left',
  'start→game':     'entering-from-right',
  'select→complete':'entering-scale',
  'game→complete':  'entering-scale',
  'complete→game':  'entering-from-right',
};

let _currentScreen = 'start';

function showScreen(name) {
  const dirKey = `${_currentScreen}→${name}`;
  const dir    = TRANSITION_DIR[dirKey] || 'entering-from-right';
  _currentScreen = name;

  Object.entries(screens).forEach(([key, el]) => {
    if (key === name) {
      el.classList.remove('entering-from-right', 'entering-from-left', 'entering-scale');
      el.classList.add('active', dir);
      // Remove direction class after animation ends
      const onEnd = () => {
        el.classList.remove(dir);
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd, { once: true });
    } else {
      el.classList.remove('active');
    }
  });

  // Aurora management
  if (name === 'game') {
    pauseAurora();
  } else {
    resumeAurora();
  }
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────

function startLevel(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return;
  currentLevelId = levelId;

  // Destroy any running game
  if (currentGame) { currentGame.destroy(); currentGame = null; }

  // Update level name in header
  const levelNameEl = document.getElementById('level-name-display');
  if (levelNameEl) levelNameEl.textContent = level.name;

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
      // Brief brightness pulse on the bar
      progressFill.classList.remove('progress-pulse');
      void progressFill.offsetWidth; // force reflow to restart animation
      progressFill.classList.add('progress-pulse');
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

      playLevelComplete();
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
  startAmbientDrone();
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
  initAurora(document.getElementById('aurora-bg'));
  await initYandex();
  appState = await loadData();
  // Show start without transition animation
  screens.start.classList.add('active');
  _currentScreen = 'start';
}

init();
