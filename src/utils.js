/**
 * Utility helpers for Diamond Painting game.
 */

/**
 * Clamp a value between min and max.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Convert a hex color string to an rgba string with optional alpha.
 * @param {string} hex   e.g. "#e94560"
 * @param {number} alpha 0–1
 * @returns {string}
 */
export function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Lighten or darken a hex color by a factor.
 * factor > 0 → lighter, factor < 0 → darker
 * @param {string} hex
 * @param {number} factor  e.g. 0.3 to lighten 30%
 * @returns {string}
 */
export function shiftColor(hex, factor) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = clamp(Math.round(r + (factor > 0 ? (255 - r) : r) * Math.abs(factor)), 0, 255);
  g = clamp(Math.round(g + (factor > 0 ? (255 - g) : g) * Math.abs(factor)), 0, 255);
  b = clamp(Math.round(b + (factor > 0 ? (255 - b) : b) * Math.abs(factor)), 0, 255);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/**
 * Convert a flat cell index to (col, row).
 * @param {number} idx
 * @param {number} width
 * @returns {{ col: number, row: number }}
 */
export function idxToCell(idx, width) {
  return { col: idx % width, row: Math.floor(idx / width) };
}

/**
 * Convert (col, row) to flat index.
 * @param {number} col
 * @param {number} row
 * @param {number} width
 * @returns {number}
 */
export function cellToIdx(col, row, width) {
  return row * width + col;
}

/**
 * Count cells matching a predicate in a Uint8Array.
 * @param {Uint8Array} cells
 * @param {function(number): boolean} predicate
 * @returns {number}
 */
export function countCells(cells, predicate) {
  let n = 0;
  for (let i = 0; i < cells.length; i++) {
    if (predicate(cells[i])) n++;
  }
  return n;
}

/**
 * Deep-clone a plain object / array (JSON-serializable only).
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Format seconds as "m:ss".
 * @param {number} secs
 * @returns {string}
 */
export function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Calculate the star rating (1–3) for a level completion.
 * @param {number} pct  0–100 percent of cells filled
 * @returns {number} 1, 2, or 3
 */
export function starRating(pct) {
  if (pct >= 100) return 3;
  if (pct >= 80)  return 2;
  return 1;
}

/**
 * Compute score for a completed level.
 * @param {number} totalCells   paintable cells
 * @param {number} filledCells  correctly filled cells
 * @param {number} elapsedSecs  time taken
 * @returns {number}
 */
export function computeScore(totalCells, filledCells, elapsedSecs) {
  const base = filledCells;
  const timeBonus = Math.max(0, 300 - elapsedSecs) * 10;
  return base + timeBonus;
}

/**
 * Debounce a function.
 * @param {function} fn
 * @param {number} delay ms
 * @returns {function}
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Convert a hex color string to HSL components.
 * @param {string} hex e.g. "#e94560"
 * @returns {{ h: number, s: number, l: number }} h: 0-360, s: 0-1, l: 0-1
 */
export function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

/**
 * Convert HSL to hex color string.
 * @param {number} h 0-360
 * @param {number} s 0-1
 * @param {number} l 0-1
 * @returns {string}
 */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const hh = h / 360;
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, hh + 1/3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1/3);
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Rotate the hue of a hex color by given degrees.
 * @param {string} hex
 * @param {number} degrees
 * @returns {string}
 */
export function rotateHue(hex, degrees) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}
