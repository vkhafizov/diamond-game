/**
 * UI components: category grid, level-select, gallery, palette tray, complete screen.
 */
import { LEVELS } from './levels.js';
import { renderPreview, renderDiamondPreview, startSparkleAnimation } from './game.js';
import { starRating } from './utils.js';
import { t } from './i18n.js';

// Category emoji map
const CAT_ICONS = {
  Symbols: '✨', Food: '🍓', Animals: '🦊', Nature: '🌸',
  Ocean: '🌊', Fantasy: '🐲', Space: '🚀', Art: '🎨', Other: '🖼️',
};

/** Get ordered unique categories from LEVELS */
function getCategories() {
  const seen = new Set();
  const cats = [];
  LEVELS.forEach(l => {
    const c = l.category || 'Other';
    if (!seen.has(c)) { seen.add(c); cats.push(c); }
  });
  return cats;
}

/** Levels that belong to a category */
function levelsByCategory(cat) {
  return LEVELS.filter(l => (l.category || 'Other') === cat);
}

/**
 * Check if a specific level is unlocked given current state.
 * Rule: first level in its category is always unlocked;
 *       subsequent levels unlock when the previous one in the same category is completed.
 */
export function isLevelUnlocked(levelId, state) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return false;
  const catLevels = levelsByCategory(level.category || 'Other');
  const posInCat  = catLevels.findIndex(l => l.id === levelId);
  if (posInCat === 0) return true;           // first in category
  const prevId = catLevels[posInCat - 1].id;
  return state.completedLevels.includes(prevId);
}

/**
 * Build the category selection grid.
 */
export function buildCategoryGrid(container, state, onSelect) {
  container.innerHTML = '';
  const cats = getCategories();

  cats.forEach(cat => {
    const levels     = levelsByCategory(cat);
    const completed  = levels.filter(l => state.completedLevels.includes(l.id)).length;

    const card = document.createElement('div');
    card.className = 'cat-card';

    const icon = document.createElement('div');
    icon.className = 'cat-icon';
    icon.textContent = CAT_ICONS[cat] || '🖼️';

    const name = document.createElement('div');
    name.className = 'cat-name';
    const tKey = 'cat_' + cat.toLowerCase();
    name.textContent = t(tKey) !== tKey ? t(tKey) : cat;

    const prog = document.createElement('div');
    prog.className = 'cat-progress';
    prog.textContent = `${completed} / ${levels.length}`;

    // Mini preview bar
    const bar = document.createElement('div');
    bar.className = 'cat-bar';
    const fill = document.createElement('div');
    fill.className = 'cat-bar-fill';
    fill.style.width = (levels.length ? (completed / levels.length * 100) : 0) + '%';
    bar.appendChild(fill);

    card.append(icon, name, prog, bar);
    card.addEventListener('click', () => onSelect(cat));
    container.appendChild(card);
  });
}

/**
 * Build the level grid for ONE category.
 */
export function buildLevelGrid(container, state, category, onSelect) {
  container.innerHTML = '';

  const levels = levelsByCategory(category);

  levels.forEach(level => {
    const card = document.createElement('div');
    card.className = 'level-card';

    const isCompleted = state.completedLevels.includes(level.id);
    const isLocked    = !isLevelUnlocked(level.id, state);

    if (isCompleted) card.classList.add('completed');
    if (isLocked)    card.classList.add('locked');

    // Preview canvas
    const previewWrap = document.createElement('div');
    previewWrap.className = 'level-preview';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width  = 110;
    previewCanvas.height = 110;
    previewCanvas.style.cssText = 'width:110px;height:110px';
    renderPreview(previewCanvas, level);
    previewWrap.appendChild(previewCanvas);

    // Stars
    const stars = document.createElement('div');
    stars.className = 'level-stars';
    stars.textContent = isCompleted ? '★★★' : '☆☆☆';

    // Name + meta
    const name = document.createElement('div');
    name.className   = 'level-name';
    // Try translated name, fall back to level.name
    const tKey = 'level_' + level.id;
    const displayName = t(tKey) !== tKey ? t(tKey) : level.name;
    name.textContent = isLocked ? '🔒 ' + displayName : displayName;

    const meta = document.createElement('div');
    meta.className   = 'level-meta';
    meta.textContent = `${level.width}×${level.height} · ${level.difficulty}`;

    card.append(previewWrap, stars, name, meta);

    if (!isLocked) {
      card.addEventListener('click', () => onSelect(level.id));
    }

    container.appendChild(card);
  });
}

/**
 * Build the gallery of completed paintings.
 */
export function buildGallery(container, state) {
  container.innerHTML = '';

  const completed = LEVELS.filter(l => state.completedLevels.includes(l.id));

  if (completed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'gallery-empty';
    empty.textContent = t('gallery_empty');
    container.appendChild(empty);
    return;
  }

  completed.forEach(level => {
    const item = document.createElement('div');
    item.className = 'gallery-item';

    const canvas = document.createElement('canvas');
    const SIZE = 140;
    canvas.width  = level.width;
    canvas.height = level.height;
    canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;image-rendering:pixelated;border-radius:10px`;

    // Render with actual diamond art (static — no sparkle on thumbnails)
    renderDiamondPreview(canvas, level);

    const name = document.createElement('div');
    name.className = 'gallery-name';
    const tKey = 'level_' + level.id;
    name.textContent = t(tKey) !== tKey ? t(tKey) : level.name;

    item.append(canvas, name);
    item.addEventListener('click', () => openLightbox(level));
    container.appendChild(item);
  });
}

// WeakMap to track sparkle stop functions
const _sparkleStops = new WeakMap();

/** Stop all sparkle animations in a container (call when leaving gallery). */
export function stopGallerySparkles(container) {
  container.querySelectorAll('.gallery-item').forEach(item => {
    const stop = _sparkleStops.get(item);
    if (stop) { stop(); _sparkleStops.delete(item); }
  });
}

// ─── Gallery Lightbox ──────────────────────────────────────────────────────

let _lightboxSparkleStop = null;

function openLightbox(level) {
  if (_lightboxSparkleStop) { _lightboxSparkleStop(); _lightboxSparkleStop = null; }

  const overlay = document.getElementById('gallery-lightbox');
  const canvas  = document.getElementById('lightbox-canvas');
  const nameEl  = document.getElementById('lightbox-name');
  if (!overlay || !canvas || !nameEl) return;

  // Compute tight bounding box of non-zero cells
  let r0 = level.height, r1 = 0, c0 = level.width, c1 = 0;
  for (let r = 0; r < level.height; r++) {
    for (let c = 0; c < level.width; c++) {
      if (level.cells[r * level.width + c] !== 0) {
        r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      }
    }
  }
  const artW = c1 - c0 + 1;
  const artH = r1 - r0 + 1;

  const maxPx = Math.min(
    Math.floor(window.innerWidth  * 0.82),
    Math.floor(window.innerHeight * 0.70),
  );
  const cellPx = Math.max(24, Math.floor(maxPx / Math.max(artW, artH)));

  // Render full grid to a temp canvas, then copy only the art bounding box
  const tmp = document.createElement('canvas');
  tmp.width  = level.width  * cellPx;
  tmp.height = level.height * cellPx;
  renderDiamondPreview(tmp, level);

  canvas.width  = artW * cellPx;
  canvas.height = artH * cellPx;
  const cssScale = maxPx / Math.max(canvas.width, canvas.height);
  canvas.style.width  = Math.round(canvas.width  * cssScale) + 'px';
  canvas.style.height = Math.round(canvas.height * cssScale) + 'px';

  canvas.getContext('2d').drawImage(tmp,
    c0 * cellPx, r0 * cellPx, artW * cellPx, artH * cellPx,
    0, 0, artW * cellPx, artH * cellPx,
  );

  // Build a cropped level so sparkles land on the correct cells
  const croppedCells = new Array(artW * artH).fill(0);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      croppedCells[(r - r0) * artW + (c - c0)] = level.cells[r * level.width + c];

  _lightboxSparkleStop = startSparkleAnimation(canvas,
    { ...level, width: artW, height: artH, cells: croppedCells },
  );

  const tKey = 'level_' + level.id;
  nameEl.textContent = t(tKey) !== tKey ? t(tKey) : level.name;
  overlay.classList.add('active');
}

export function closeLightbox() {
  if (_lightboxSparkleStop) { _lightboxSparkleStop(); _lightboxSparkleStop = null; }
  const overlay = document.getElementById('gallery-lightbox');
  if (overlay) overlay.classList.remove('active');
}

// Wire up close button and backdrop click — DOM is already available (module is deferred)
{
  const overlay  = document.getElementById('gallery-lightbox');
  const closeBtn = document.getElementById('lightbox-close');
  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
  if (overlay)  overlay.addEventListener('click', e => { if (e.target === overlay) closeLightbox(); });
}

/**
 * Build the palette tray swatches.
 */
export function buildPalette(container, palette, selectedId, onSelect) {
  container.innerHTML = '';

  palette.forEach(({ id, color, label }) => {
    const swatch = document.createElement('div');
    swatch.className        = 'palette-swatch';
    swatch.style.background = color;
    swatch.dataset.id       = id;
    swatch.title            = label;

    const num = document.createElement('span');
    num.textContent = String(id);
    swatch.appendChild(num);

    if (id === selectedId) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
      container.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      onSelect(id);
    });

    container.appendChild(swatch);
  });
}

/**
 * Update palette selection highlight.
 */
export function setPaletteSelection(container, colorId) {
  container.querySelectorAll('.palette-swatch').forEach(s => {
    s.classList.toggle('selected', Number(s.dataset.id) === colorId);
  });
}

/** Active sparkle stop for complete screen */
let _completeSparkleStop = null;

/**
 * Render the complete screen with animated diamond painting.
 */
export function showCompleteScreen(level, score, stars, scoreLabel = 'Score:') {
  // Stop any previous sparkle
  if (_completeSparkleStop) { _completeSparkleStop(); _completeSparkleStop = null; }

  const wrap   = document.getElementById('complete-image-wrap');
  const rating = document.getElementById('star-rating');
  const scoreEl= document.getElementById('complete-score');

  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  const size   = Math.min(280, Math.min(window.innerWidth * 0.8, window.innerHeight * 0.4));
  canvas.width  = level.width;
  canvas.height = level.height;
  canvas.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;border-radius:12px`;

  // Render actual diamond art
  renderDiamondPreview(canvas, level);
  // Start sparkle animation
  _completeSparkleStop = startSparkleAnimation(canvas, level);

  wrap.appendChild(canvas);

  rating.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    span.textContent = i < stars ? '★' : '☆';
    rating.appendChild(span);
  }
  scoreEl.textContent = `${scoreLabel} ${score.toLocaleString()}`;
}

/** Stop complete screen sparkle (call when leaving complete screen). */
export function stopCompleteSparkle() {
  if (_completeSparkleStop) { _completeSparkleStop(); _completeSparkleStop = null; }
}
