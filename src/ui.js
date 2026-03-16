/**
 * UI components: level-select grid, palette tray, complete screen.
 */
import { LEVELS } from './levels.js';
import { renderPreview } from './game.js';
import { starRating } from './utils.js';

/**
 * Populate the level-select grid.
 * @param {HTMLElement}   container      #level-grid
 * @param {object}        state          app state (completedLevels, scores)
 * @param {function}      onSelect       (levelId: number) => void
 */
export function buildLevelGrid(container, state, onSelect) {
  container.innerHTML = '';

  LEVELS.forEach(level => {
    const card = document.createElement('div');
    card.className = 'level-card';

    const isCompleted = state.completedLevels.includes(level.id);
    const isLocked    = level.id > 1 && !state.completedLevels.includes(level.id - 1);

    if (isCompleted) card.classList.add('completed');
    if (isLocked)    card.classList.add('locked');

    // Preview canvas
    const previewWrap = document.createElement('div');
    previewWrap.className = 'level-preview';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width  = level.width;
    previewCanvas.height = level.height;
    previewCanvas.style.cssText = 'width:80px;height:80px;image-rendering:pixelated';
    renderPreview(previewCanvas, level);
    previewWrap.appendChild(previewCanvas);

    // Stars
    const stars = document.createElement('div');
    stars.className = 'level-stars';
    const savedScore = state.scores[level.id];
    if (isCompleted && savedScore) {
      const s = starRating(100); // completed = 3 stars (simplification)
      stars.textContent = '★'.repeat(s) + '☆'.repeat(3 - s);
    } else {
      stars.textContent = '☆☆☆';
    }

    // Name + meta
    const name = document.createElement('div');
    name.className   = 'level-name';
    name.textContent = isLocked ? '🔒 ' + level.name : level.name;

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
 * Build the palette tray swatches.
 * @param {HTMLElement}  container      #palette-colors
 * @param {object[]}     palette        level.palette
 * @param {number}       selectedId     initially selected color id
 * @param {function}     onSelect       (colorId: number) => void
 */
export function buildPalette(container, palette, selectedId, onSelect) {
  container.innerHTML = '';

  palette.forEach(({ id, color, label }) => {
    const swatch = document.createElement('div');
    swatch.className       = 'palette-swatch';
    swatch.style.background = color;
    swatch.dataset.id      = id;
    swatch.title           = label;

    // Show number
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
 * @param {HTMLElement} container
 * @param {number} colorId
 */
export function setPaletteSelection(container, colorId) {
  container.querySelectorAll('.palette-swatch').forEach(s => {
    s.classList.toggle('selected', Number(s.dataset.id) === colorId);
  });
}

/**
 * Render the complete screen with the finished painting.
 * @param {object} level
 * @param {number} score
 * @param {number} stars
 */
export function showCompleteScreen(level, score, stars) {
  const wrap   = document.getElementById('complete-image-wrap');
  const rating = document.getElementById('star-rating');
  const scoreEl= document.getElementById('complete-score');

  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  const size   = Math.min(280, Math.min(window.innerWidth * 0.8, window.innerHeight * 0.4));
  canvas.width  = level.width;
  canvas.height = level.height;
  canvas.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;border-radius:12px`;
  renderPreview(canvas, level);
  wrap.appendChild(canvas);

  rating.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  scoreEl.textContent = `Score: ${score.toLocaleString()}`;
}
