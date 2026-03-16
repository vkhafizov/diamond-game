/**
 * Core game engine: canvas rendering, input handling, game state.
 */
import { clamp, hexToRgba, shiftColor, cellToIdx, countCells, computeScore } from './utils.js';

const CELL_BASE = 24;     // base cell size in px before zoom
const MIN_ZOOM  = 0.5;
const MAX_ZOOM  = 4.0;

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} level  – level definition from levels.js
   * @param {object} savedProgress  – { filledCells: number[] } or null
   * @param {function} onProgress  – (pct: number) => void
   * @param {function} onComplete  – (score: number, stars: number) => void
   */
  constructor(canvas, level, savedProgress, onProgress, onComplete) {
    this.canvas      = canvas;
    this.ctx         = canvas.getContext('2d');
    this.level       = level;
    this.onProgress  = onProgress;
    this.onComplete  = onComplete;

    // Build set of filled cell indices from saved progress
    this.filled = new Set(savedProgress ? savedProgress.filledCells : []);

    // Build palette map: id → color
    this.paletteMap = new Map(level.palette.map(p => [p.id, p.color]));

    // Count total paintable cells (non-zero)
    this.totalPaintable = countCells(level.cells, v => v !== 0);

    // Currently selected color id
    this.selectedColor = level.palette[0]?.id ?? 1;

    // Viewport transform
    this.zoom    = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Timing
    this.startTime   = Date.now();
    this.elapsedSecs = 0;
    this._timerID    = null;

    // Pointer state for pan
    this._pointers    = new Map();   // pointerId → {x,y}
    this._lastPinchDist = null;
    this._isPanning   = false;
    this._panStart    = null;

    // Flash animations: Map<idx, { until: timestamp }>
    this._flashes = new Map();

    this._bindEvents();
    this._fitToCanvas();
    this._startTimer();
    this._loop();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Select a palette color by id. */
  selectColor(id) {
    this.selectedColor = id;
  }

  /** Hint: fill all visible cells of the selected color. */
  bucketFill() {
    const { cells, width } = this.level;
    let changed = false;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === this.selectedColor && !this.filled.has(i)) {
        this.filled.add(i);
        changed = true;
      }
    }
    if (changed) this._afterFill();
  }

  /** Serialize progress for saving. */
  getProgress() {
    return { filledCells: [...this.filled] };
  }

  /** Stop the game loop and timers. */
  destroy() {
    this._stopTimer();
    this._destroyed = true;
    this._unbindEvents();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _startTimer() {
    this._timerID = setInterval(() => { this.elapsedSecs++; }, 1000);
  }

  _stopTimer() {
    clearInterval(this._timerID);
  }

  _fitToCanvas() {
    const { width, height } = this.level;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const gridW = width  * CELL_BASE;
    const gridH = height * CELL_BASE;
    this.zoom    = Math.min(cw / gridW, ch / gridH) * 0.92;
    this.offsetX = (cw - gridW * this.zoom) / 2;
    this.offsetY = (ch - gridH * this.zoom) / 2;
  }

  _cellSize() {
    return CELL_BASE * this.zoom;
  }

  // Canvas (px) → grid cell (col, row)
  _hitTest(cx, cy) {
    const cs   = this._cellSize();
    const col  = Math.floor((cx - this.offsetX) / cs);
    const row  = Math.floor((cy - this.offsetY) / cs);
    const { width, height } = this.level;
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    return { col, row, idx: cellToIdx(col, row, width) };
  }

  _fillCell(idx) {
    const target = this.level.cells[idx];
    if (target === 0 || this.filled.has(idx)) return;
    if (target !== this.selectedColor) {
      // Wrong color: flash red
      this._flashes.set(idx, { until: Date.now() + 300, correct: false });
      return;
    }
    this.filled.add(idx);
    this._flashes.set(idx, { until: Date.now() + 400, correct: true });
    this._afterFill();
  }

  _afterFill() {
    const pct = Math.round((this.filled.size / this.totalPaintable) * 100);
    this.onProgress(pct);
    if (this.filled.size >= this.totalPaintable) {
      this._stopTimer();
      const score = computeScore(this.totalPaintable, this.filled.size, this.elapsedSecs);
      const stars = pct >= 100 ? 3 : pct >= 80 ? 2 : 1;
      setTimeout(() => this.onComplete(score, stars), 600);
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  _loop() {
    if (this._destroyed) return;
    this._draw();
    requestAnimationFrame(() => this._loop());
  }

  _draw() {
    const { ctx, canvas, level } = this;
    const { width, height, cells, palette } = level;
    const cs   = this._cellSize();
    const now  = Date.now();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ox = this.offsetX;
    const oy = this.offsetY;

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx    = cellToIdx(col, row, width);
        const target = cells[idx];
        const x      = ox + col * cs;
        const y      = oy + row * cs;

        if (target === 0) {
          // Empty cell – faint background
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
          continue;
        }

        const flash = this._flashes.get(idx);
        const isFlashing = flash && flash.until > now;

        if (this.filled.has(idx)) {
          // Filled diamond
          const color = this.paletteMap.get(target) ?? '#888';
          this._drawDiamond(ctx, x, y, cs, color, isFlashing && flash.correct);
        } else {
          // Unfilled cell
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);

          if (isFlashing && !flash.correct) {
            ctx.fillStyle = 'rgba(239,68,68,0.45)';
            ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
          }

          // Number hint (only visible when cell is large enough)
          if (cs >= 16) {
            ctx.fillStyle = hexToRgba(this.paletteMap.get(target) ?? '#888', 0.55);
            ctx.font = `bold ${Math.max(8, Math.round(cs * 0.38))}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(target), x + cs / 2, y + cs / 2);
          }
        }

        // Grid lines
        ctx.strokeStyle = '#ffffff08';
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(x, y, cs, cs);
      }
    }

    // Clean expired flashes
    for (const [idx, f] of this._flashes) {
      if (f.until <= now) this._flashes.delete(idx);
    }
  }

  /**
   * Draw a shiny diamond shape in a cell.
   */
  _drawDiamond(ctx, x, y, cs, color, glitter = false) {
    const cx = x + cs / 2;
    const cy = y + cs / 2;
    const hw = cs * 0.42;
    const hh = cs * 0.42;

    ctx.save();

    // Shadow
    ctx.shadowColor   = hexToRgba(color, 0.6);
    ctx.shadowBlur    = cs * 0.3;

    // Diamond path
    ctx.beginPath();
    ctx.moveTo(cx,      cy - hh);  // top
    ctx.lineTo(cx + hw, cy);       // right
    ctx.lineTo(cx,      cy + hh);  // bottom
    ctx.lineTo(cx - hw, cy);       // left
    ctx.closePath();

    // Fill gradient
    const grad = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
    grad.addColorStop(0,    shiftColor(color,  0.5));
    grad.addColorStop(0.45, color);
    grad.addColorStop(1,    shiftColor(color, -0.35));
    ctx.fillStyle = grad;
    ctx.fill();

    // Highlight
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.1, cy - hh * 0.8);
    ctx.lineTo(cx + hw * 0.35, cy - hh * 0.25);
    ctx.lineTo(cx - hw * 0.05, cy - hh * 0.05);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();

    if (glitter) {
      // Sparkle on correct fill
      const r = cs * 0.12;
      ctx.shadowBlur = cs * 0.5;
      ctx.shadowColor = '#fff';
      ctx.fillStyle   = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(cx + hw * 0.2, cy - hh * 0.55, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ─── Event Handling ────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;
    this._onPointerDown  = this._onPointerDown.bind(this);
    this._onPointerMove  = this._onPointerMove.bind(this);
    this._onPointerUp    = this._onPointerUp.bind(this);
    this._onWheel        = this._onWheel.bind(this);
    c.addEventListener('pointerdown',  this._onPointerDown);
    c.addEventListener('pointermove',  this._onPointerMove);
    c.addEventListener('pointerup',    this._onPointerUp);
    c.addEventListener('pointercancel',this._onPointerUp);
    c.addEventListener('wheel',        this._onWheel, { passive: false });
  }

  _unbindEvents() {
    const c = this.canvas;
    c.removeEventListener('pointerdown',  this._onPointerDown);
    c.removeEventListener('pointermove',  this._onPointerMove);
    c.removeEventListener('pointerup',    this._onPointerUp);
    c.removeEventListener('pointercancel',this._onPointerUp);
    c.removeEventListener('wheel',        this._onWheel);
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  _onPointerDown(e) {
    e.preventDefault();
    const pos = this._canvasPos(e);
    this._pointers.set(e.pointerId, pos);
    this.canvas.setPointerCapture(e.pointerId);

    if (this._pointers.size === 1) {
      // Single finger/click: fill or start pan
      this._panStart   = { ...pos, ox: this.offsetX, oy: this.offsetY };
      this._isPanning  = false;
      this._tapPos     = pos;
    } else if (this._pointers.size === 2) {
      // Two fingers: pinch-to-zoom
      const pts = [...this._pointers.values()];
      this._lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  }

  _onPointerMove(e) {
    e.preventDefault();
    const pos = this._canvasPos(e);
    this._pointers.set(e.pointerId, pos);

    if (this._pointers.size === 2) {
      // Pinch zoom
      const pts  = [...this._pointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (this._lastPinchDist !== null) {
        const factor = dist / this._lastPinchDist;
        const mx = (pts[0].x + pts[1].x) / 2;
        const my = (pts[0].y + pts[1].y) / 2;
        this._applyZoom(factor, mx, my);
      }
      this._lastPinchDist = dist;
      this._isPanning     = true; // suppress tap
    } else if (this._pointers.size === 1 && this._panStart) {
      const dx = pos.x - this._panStart.x;
      const dy = pos.y - this._panStart.y;
      if (!this._isPanning && Math.hypot(dx, dy) > 5) {
        this._isPanning = true;
      }
      if (this._isPanning) {
        this.offsetX = this._panStart.ox + dx;
        this.offsetY = this._panStart.oy + dy;
      }
    }
  }

  _onPointerUp(e) {
    e.preventDefault();
    const pos = this._canvasPos(e);
    const wasPane = this._isPanning;
    this._pointers.delete(e.pointerId);

    if (this._pointers.size < 2) this._lastPinchDist = null;

    if (this._pointers.size === 0) {
      if (!wasPane) {
        // Tap = fill cell
        const hit = this._hitTest(pos.x, pos.y);
        if (hit) this._fillCell(hit.idx);
      }
      this._isPanning = false;
      this._panStart  = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const rect  = this.canvas.getBoundingClientRect();
    const mx    = (e.clientX - rect.left) * (this.canvas.width  / rect.width);
    const my    = (e.clientY - rect.top)  * (this.canvas.height / rect.height);
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this._applyZoom(delta, mx, my);
  }

  _applyZoom(factor, mx, my) {
    const newZoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const ratio   = newZoom / this.zoom;
    this.offsetX  = mx - (mx - this.offsetX) * ratio;
    this.offsetY  = my - (my - this.offsetY) * ratio;
    this.zoom     = newZoom;
  }

  // ─── Canvas resize ─────────────────────────────────────────────────────────

  resize(w, h) {
    const prevW = this.canvas.width;
    const prevH = this.canvas.height;
    this.canvas.width  = w;
    this.canvas.height = h;
    // Shift offset to keep center
    this.offsetX += (w - prevW) / 2;
    this.offsetY += (h - prevH) / 2;
  }
}

/**
 * Render a small static preview of a level onto a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {object} level
 */
export function renderPreview(canvas, level) {
  const { width, height, cells, palette } = level;
  const ctx  = canvas.getContext('2d');
  const cs   = canvas.width / width;
  const map  = new Map(palette.map(p => [p.id, p.color]));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const v = cells[row * width + col];
      ctx.fillStyle = v === 0 ? '#1e293b' : (map.get(v) ?? '#888');
      ctx.fillRect(col * cs, row * cs, cs, cs);
    }
  }
}
