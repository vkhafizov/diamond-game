/**
 * Bootstrap & screen router for Diamond Painting game.
 *
 * Screens:  start → categories → select → game → complete
 *                                  ↑                 |
 *                                  └─────────────────┘
 *
 * Additional:  start ↔ settings
 *              start ↔ about
 *              start/drawer → gallery
 */
import { LEVELS }       from './levels.js';
import { Game }         from './game.js';
import {
  buildCategoryGrid,
  buildLevelGrid,
  buildGallery,
  stopGallerySparkles,
  closeLightbox,
  buildPalette,
  showCompleteScreen,
  stopCompleteSparkle,
  isLevelUnlocked,
} from './ui.js';
import {
  initYandex, loadData, saveData,
  submitScore, showLeaderboard,
  showInterstitial, showRewardedAd,
  getLang, gameplayStart, gameplayStop,
} from './yandex.js';
import { initAurora, pauseAurora, resumeAurora } from './aurora.js';
import {
  startAmbientDrone, stopAmbientDrone,
  playLevelComplete,
  setMusicEnabled, setSfxEnabled,
  setMusicVolume, setSfxVolume,
} from './audio.js';
import {
  LANGUAGES, setLanguage, getLanguage, detectLanguage, t,
} from './i18n.js';

// ─── App State ────────────────────────────────────────────────────────────────

let appState = {
  completedLevels: [],
  scores:   {},
  progress: {},
  lastLevelId: null,
};

// Settings state (persisted to localStorage separately)
let settings = {
  music:       true,
  sfx:         true,
  particles:   true,
  musicVolume: 0.5,
  sfxVolume:   0.7,
};

let currentGame     = null;
let currentLevelId  = null;
let currentCategory = null;   // track which category is open in level-select
let autoSaveTimer   = null;

// Screen to return to when pressing back from settings/about
let _returnScreen = 'start';

// ─── Settings persistence ─────────────────────────────────────────────────────

function loadSettings() {
  try {
    const raw = localStorage.getItem('dp_settings');
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveSettings() {
  try { localStorage.setItem('dp_settings', JSON.stringify(settings)); } catch (_) {}
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const screens = {
  start:      document.getElementById('screen-start'),
  categories: document.getElementById('screen-categories'),
  select:     document.getElementById('screen-select'),
  gallery:    document.getElementById('screen-gallery'),
  game:       document.getElementById('screen-game'),
  complete:   document.getElementById('screen-complete'),
  settings:   document.getElementById('screen-settings'),
  about:      document.getElementById('screen-about'),
};

const canvas         = document.getElementById('game-canvas');
const progressFill   = document.getElementById('progress-fill');
const progressText   = document.getElementById('progress-text');
const paletteColors  = document.getElementById('palette-colors');
const levelGrid      = document.getElementById('level-grid');
const categoryGrid   = document.getElementById('category-grid');
const galleryGrid    = document.getElementById('gallery-grid');

// ─── Screen transitions ───────────────────────────────────────────────────────

const TRANSITION_DIR = {
  'start→categories':    'entering-from-right',
  'start→settings':      'entering-from-right',
  'start→about':         'entering-from-right',
  'start→gallery':       'entering-from-right',
  'categories→select':   'entering-from-right',
  'categories→start':    'entering-from-left',
  'select→game':         'entering-from-right',
  'select→categories':   'entering-from-left',
  'game→select':         'entering-from-left',
  'game→categories':     'entering-from-left',
  'complete→select':     'entering-from-left',
  'complete→categories': 'entering-from-left',
  'start→game':          'entering-from-right',
  'select→complete':     'entering-scale',
  'game→complete':       'entering-scale',
  'complete→game':       'entering-from-right',
  'settings→start':      'entering-from-left',
  'about→start':         'entering-from-left',
  'gallery→start':       'entering-from-left',
};

let _currentScreen = 'start';

function showScreen(name) {
  const dirKey = `${_currentScreen}→${name}`;
  const dir    = TRANSITION_DIR[dirKey] || 'entering-from-right';

  // Stop sparkles / lightbox when leaving complete or gallery screens
  if (_currentScreen === 'complete') stopCompleteSparkle();
  if (_currentScreen === 'gallery')  { stopGallerySparkles(galleryGrid); closeLightbox(); }

  _currentScreen = name;

  Object.entries(screens).forEach(([key, el]) => {
    if (key === name) {
      el.classList.remove('entering-from-right', 'entering-from-left', 'entering-scale');
      el.classList.add('active', dir);
      const onEnd = () => {
        el.classList.remove(dir);
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd, { once: true });
    } else {
      el.classList.remove('active');
    }
  });

  // Sync body class so CSS can hide burger on start screen
  document.body.className = `screen-${name}`;

  if (name === 'game') {
    pauseAurora();
  } else {
    resumeAurora();
  }

  closeDrawer();
}

// ─── Translations ─────────────────────────────────────────────────────────────

/**
 * Apply translated strings to all data-i18n* elements in the document.
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

// ─── Language grid ────────────────────────────────────────────────────────────

function buildLanguageGrid() {
  const grid = document.getElementById('language-grid');
  grid.innerHTML = '';
  const current = getLanguage();

  LANGUAGES.forEach(({ code, label, flag }) => {
    const btn = document.createElement('button');
    btn.className = 'lang-btn' + (code === current ? ' active' : '');
    btn.innerHTML = `<span class="lang-flag">${flag}</span><span class="lang-label">${label}</span>`;
    btn.addEventListener('click', () => {
      setLanguage(code);
      applyTranslations();
      buildLanguageGrid(); // refresh active state
    });
    grid.appendChild(btn);
  });
}

// ─── Settings UI sync ─────────────────────────────────────────────────────────

function syncSettingsUI() {
  document.getElementById('toggle-music').checked     = settings.music;
  document.getElementById('toggle-sfx').checked       = settings.sfx;
  document.getElementById('toggle-particles').checked = settings.particles;
  document.getElementById('slider-music').value = Math.round(settings.musicVolume * 100);
  document.getElementById('slider-sfx').value   = Math.round(settings.sfxVolume   * 100);
}

// ─── Category / Level select helpers ─────────────────────────────────────────

function openCategory(cat) {
  currentCategory = cat;
  // Update the category title in the level-select header
  const titleEl = document.getElementById('select-category-title');
  if (titleEl) {
    const tKey = 'cat_' + cat.toLowerCase();
    titleEl.textContent = t(tKey) !== tKey ? t(tKey) : cat;
  }
  buildLevelGrid(levelGrid, appState, cat, async (id) => {
    stopAmbientDrone();
    gameplayStop();
    await showInterstitial();
    startLevel(id);
  });
  showScreen('select');
}

function rebuildCurrentLevelGrid() {
  if (currentCategory) {
    buildLevelGrid(levelGrid, appState, currentCategory, async (id) => {
      stopAmbientDrone();
      gameplayStop();
      await showInterstitial();
      startLevel(id);
    });
  }
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────

function startLevel(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return;
  currentLevelId = levelId;

  if (currentGame) { currentGame.destroy(); currentGame = null; }

  appState.lastLevelId = levelId;

  resizeCanvas();

  buildPalette(
    paletteColors,
    level.palette,
    level.palette[0]?.id,
    id => currentGame?.selectColor(id),
  );

  const savedProgress = appState.progress[levelId] ?? null;

  currentGame = new Game(
    canvas,
    level,
    savedProgress,
    // onProgress
    (pct) => {
      progressFill.style.width = pct + '%';
      progressText.textContent = pct + '%';
      progressFill.classList.remove('progress-pulse');
      void progressFill.offsetWidth;
      progressFill.classList.add('progress-pulse');
    },
    // onComplete
    async (score, stars) => {
      clearInterval(autoSaveTimer);

      if (!appState.completedLevels.includes(levelId)) {
        appState.completedLevels.push(levelId);
      }
      const prev = appState.scores[levelId] ?? 0;
      appState.scores[levelId] = Math.max(prev, score);
      delete appState.progress[levelId];
      syncContinueButton();

      await saveData(appState);
      await submitScore(appState.scores[levelId]);

      playLevelComplete();

      // Update complete screen texts for current language
      const titleEl = document.getElementById('complete-title');
      if (titleEl) titleEl.textContent = t('complete_title');

      showCompleteScreen(level, score, stars, t('score_label'));
      gameplayStop();
      showScreen('complete');

      // Find next level in the same category
      const catLevels = LEVELS.filter(l => (l.category || 'Other') === (level.category || 'Other'));
      const posInCat  = catLevels.findIndex(l => l.id === levelId);
      const nextInCat = posInCat >= 0 && posInCat < catLevels.length - 1 ? catLevels[posInCat + 1] : null;

      const btnNext = document.getElementById('btn-next-level');
      btnNext.classList.toggle('hidden', !nextInCat);
      btnNext.textContent = t('btn_next_level');
      // Store next level id
      if (nextInCat) btnNext.dataset.nextId = nextInCat.id;
    },
  );

  // Apply particles setting immediately
  currentGame.setParticlesEnabled(settings.particles);

  // Start ambient music (safe to call multiple times — no-ops if already running)
  startAmbientDrone();

  autoSaveTimer = setInterval(async () => {
    if (currentGame) {
      appState.progress[levelId] = currentGame.getProgress();
      await saveData(appState);
    }
  }, 30_000);

  showScreen('game');
  gameplayStart();
  // Re-center art once the game screen is fully laid out
  requestAnimationFrame(() => { if (currentGame) currentGame.resetView(); });
}

function stopCurrentGame() {
  clearInterval(autoSaveTimer);
  gameplayStop();
  if (currentGame) {
    if (currentLevelId !== null) {
      appState.progress[currentLevelId] = currentGame.getProgress();
      saveData(appState);
    }
    currentGame.destroy();
    currentGame    = null;
    currentLevelId = null;
  }
}

// ─── Continue button ──────────────────────────────────────────────────────────

function syncContinueButton() {
  const btn = document.getElementById('btn-continue');
  if (!btn) return;
  const id = appState.lastLevelId;
  const show = id !== null && !!appState.progress[id];
  btn.classList.toggle('hidden', !show);
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

// — Start screen —
document.getElementById('btn-continue').addEventListener('click', async () => {
  const id = appState.lastLevelId;
  if (id !== null) {
    stopAmbientDrone();
    gameplayStop();
    await showInterstitial();
    startLevel(id);
  }
});

document.getElementById('btn-play').addEventListener('click', () => {
  startAmbientDrone();
  buildCategoryGrid(categoryGrid, appState, (cat) => openCategory(cat));
  showScreen('categories');
});

document.getElementById('btn-leaderboard').addEventListener('click', showLeaderboard);

document.getElementById('btn-gallery').addEventListener('click', () => {
  buildGallery(galleryGrid, appState);
  showScreen('gallery');
});

document.getElementById('btn-settings').addEventListener('click', () => {
  _returnScreen = _currentScreen;
  syncSettingsUI();
  buildLanguageGrid();
  showScreen('settings');
});

document.getElementById('btn-about').addEventListener('click', () => {
  _returnScreen = _currentScreen;
  showScreen('about');
});

// — Category select —
document.getElementById('btn-back-categories').addEventListener('click', () => showScreen('start'));

// — Level select —
document.getElementById('btn-back-select').addEventListener('click', () => {
  buildCategoryGrid(categoryGrid, appState, (cat) => openCategory(cat));
  showScreen('categories');
});

// — Gallery —
document.getElementById('btn-back-gallery').addEventListener('click', () => showScreen('start'));

// — Game —
document.getElementById('btn-back-game').addEventListener('click', () => {
  stopCurrentGame();
  rebuildCurrentLevelGrid();
  showScreen('select');
});

document.getElementById('btn-hint').addEventListener('click', async () => {
  if (!currentGame) return;
  stopAmbientDrone();
  const rewarded = await showRewardedAd();
  if (settings.music) startAmbientDrone();
  if (rewarded) currentGame.bucketFill();
});

// — Complete screen —
document.getElementById('btn-next-level').addEventListener('click', async () => {
  const btnNext = document.getElementById('btn-next-level');
  const nextId = parseInt(btnNext.dataset.nextId, 10);
  if (nextId) {
    stopAmbientDrone();
    gameplayStop();
    await showInterstitial();
    startLevel(nextId);
  }
});

document.getElementById('btn-back-select2').addEventListener('click', () => {
  rebuildCurrentLevelGrid();
  showScreen('select');
});

// — Settings screen —
document.getElementById('btn-back-settings').addEventListener('click', () => showScreen(_returnScreen));

document.getElementById('toggle-music').addEventListener('change', e => {
  settings.music = e.target.checked;
  setMusicEnabled(settings.music);
  if (settings.music) startAmbientDrone(); // re-start if drone was stopped
  saveSettings();
});

document.getElementById('toggle-sfx').addEventListener('change', e => {
  settings.sfx = e.target.checked;
  setSfxEnabled(settings.sfx);
  saveSettings();
});

document.getElementById('toggle-particles').addEventListener('change', e => {
  settings.particles = e.target.checked;
  if (currentGame?.setParticlesEnabled) {
    currentGame.setParticlesEnabled(settings.particles);
  }
  saveSettings();
});

document.getElementById('slider-music').addEventListener('input', e => {
  settings.musicVolume = e.target.value / 100;
  setMusicVolume(settings.musicVolume);
  saveSettings();
});

document.getElementById('slider-sfx').addEventListener('input', e => {
  settings.sfxVolume = e.target.value / 100;
  setSfxVolume(settings.sfxVolume);
  saveSettings();
});

document.getElementById('btn-reset-progress').addEventListener('click', async () => {
  const msg = t('reset_confirm');
  if (!confirm(msg)) return;
  appState = { completedLevels: [], scores: {}, progress: {} };
  await saveData(appState);
  buildCategoryGrid(categoryGrid, appState, (cat) => openCategory(cat));
  showScreen('start');
});

// — About screen —
document.getElementById('btn-back-about').addEventListener('click', () => showScreen(_returnScreen));

// ─── Burger / Nav Drawer ──────────────────────────────────────────────────────

const burgerBtn   = document.getElementById('btn-burger');
const navDrawer   = document.getElementById('nav-drawer');
const navBackdrop = document.getElementById('nav-backdrop');

function openDrawer() {
  // Show/hide Continue option depending on active game
  const hasgame = currentGame !== null;
  document.getElementById('dnav-continue').classList.toggle('hidden', !hasgame);
  document.getElementById('dnav-continue-sep').classList.toggle('hidden', !hasgame);
  navDrawer.classList.add('open');
  navBackdrop.classList.add('visible');
  burgerBtn.classList.add('open');
}

function closeDrawer() {
  navDrawer.classList.remove('open');
  navBackdrop.classList.remove('visible');
  burgerBtn.classList.remove('open');
}

burgerBtn.addEventListener('click', () => {
  if (navDrawer.classList.contains('open')) closeDrawer();
  else openDrawer();
});

navBackdrop.addEventListener('click', closeDrawer);

document.getElementById('dnav-continue').addEventListener('click', () => showScreen('game'));

document.getElementById('dnav-home').addEventListener('click', () => showScreen('start'));

document.getElementById('dnav-play').addEventListener('click', () => {
  buildCategoryGrid(categoryGrid, appState, (cat) => openCategory(cat));
  showScreen('categories');
});

document.getElementById('dnav-gallery').addEventListener('click', () => {
  buildGallery(galleryGrid, appState);
  showScreen('gallery');
});

document.getElementById('dnav-settings').addEventListener('click', () => {
  _returnScreen = _currentScreen;
  syncSettingsUI();
  buildLanguageGrid();
  showScreen('settings');
});

document.getElementById('dnav-about').addEventListener('click', () => {
  _returnScreen = _currentScreen;
  showScreen('about');
});

document.getElementById('dnav-leaderboard').addEventListener('click', () => {
  closeDrawer();
  showLeaderboard();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Load persisted settings
  loadSettings();

  // Boot audio state
  setMusicEnabled(settings.music);
  setSfxEnabled(settings.sfx);
  setMusicVolume(settings.musicVolume);
  setSfxVolume(settings.sfxVolume);

  // Boot visual layer
  initAurora(document.getElementById('aurora-bg'));

  // Init Yandex SDK
  const yandexAvailable = await initYandex();

  // Language: Yandex SDK language takes priority when running inside Yandex Games
  // (required by Yandex moderation). Fall back to localStorage/navigator otherwise.
  if (yandexAvailable) {
    setLanguage(getLang());
  } else {
    detectLanguage(getLang());
  }
  applyTranslations();

  // Load game progress
  appState = await loadData();
  syncContinueButton();

  // Show start screen without transition animation
  screens.start.classList.add('active');
  _currentScreen = 'start';
  document.body.className = 'screen-start';
}

init();
