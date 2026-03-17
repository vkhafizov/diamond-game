/**
 * Core game engine: canvas rendering, input handling, game state.
 */
import { clamp, hexToRgba, shiftColor, rotateHue, cellToIdx, countCells, computeScore } from './utils.js';
import { playPlace, playGroupComplete } from './audio.js';

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
    this._pointers      = new Map();
    this._lastPinchDist = null;
    this._isPanning     = false;
    this._panStart      = null;

    // Flash animations: Map<idx, { until, correct }>
    this._flashes = new Map();

    // Entrance scale animations: Map<idx, { start, duration }>
    this._cellEnter = new Map();

    // Color group completion tracking
    this._completedGroups = new Set();
    this._groupFlashes    = new Map();   // colorId → { until }

    // Particles enabled flag (toggled by settings)
    this._particlesEnabled = true;

    // Background particles (Tier 1: ambient crystal dust)
    this._particles = [];
    // Burst particles (Tier 2: placement burst, Tier 3: group cascade)
    this._burstParticles = [];
    // Shine sparkles on random filled diamonds
    this._shineSparkles  = [];
    this._nextShineTime  = 0;

    this._bindEvents();
    this._fitToCanvas();
    this._initParticles();
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
    const { cells } = this.level;
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

  /** Enable or disable particle effects. */
  setParticlesEnabled(val) {
    this._particlesEnabled = Boolean(val);
    if (!this._particlesEnabled) {
      this._particles      = [];
      this._burstParticles = [];
      this._shineSparkles  = [];
    } else if (this._particles.length === 0) {
      this._initParticles();
    }
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
    const { width, height, cells } = this.level;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Center on the bounding box of paintable cells, not the full grid
    let r0 = height, r1 = 0, c0 = width, c1 = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== 0) {
        const r = Math.floor(i / width), c = i % width;
        r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      }
    }
    if (r0 > r1) { r0 = 0; r1 = height - 1; c0 = 0; c1 = width - 1; }

    const artCols = c1 - c0 + 1;
    const artRows = r1 - r0 + 1;
    this.zoom    = Math.min(cw / (artCols * CELL_BASE), ch / (artRows * CELL_BASE)) * 0.96;
    const cs     = CELL_BASE * this.zoom;
    this.offsetX = (cw - artCols * cs) / 2 - c0 * cs;
    this.offsetY = (ch - artRows * cs) / 2 - r0 * cs;
  }

  /** Re-center art in canvas (call after canvas is resized). */
  resetView() { this._fitToCanvas(); }

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
    this._flashes.set(idx, { until: Date.now() + 700, correct: true });
    // Entrance bounce animation
    this._cellEnter.set(idx, { start: Date.now(), duration: 450 });
    if (this._particlesEnabled) this._spawnBurst(idx);
    playPlace();
    this._afterFill();
  }

  _afterFill() {
    const pct = Math.round((this.filled.size / this.totalPaintable) * 100);
    this.onProgress(pct);

    // Detect newly completed color groups
    const { cells, palette } = this.level;
    for (const { id } of palette) {
      if (!this._completedGroups.has(id)) {
        const total = countCells(cells, v => v === id);
        if (total === 0) continue;
        let filledN = 0;
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] === id && this.filled.has(i)) filledN++;
        }
        if (filledN >= total) {
          this._completedGroups.add(id);
          this._groupFlashes.set(id, { until: Date.now() + 1000 });
          if (this._particlesEnabled) this._spawnGroupCascade(id);
          playGroupComplete();
        }
      }
    }

    if (this.filled.size >= this.totalPaintable) {
      this._stopTimer();
      const score = computeScore(this.totalPaintable, this.filled.size, this.elapsedSecs);
      const stars = pct >= 100 ? 3 : pct >= 80 ? 2 : 1;
      setTimeout(() => this.onComplete(score, stars), 600);
    }
  }

  // ─── Particles ─────────────────────────────────────────────────────────────

  // Tier 1: Ambient crystal dust
  static _DUST_COLORS = ['#c4b5fd', '#67e8f9', '#f0abfc', '#fde68a', '#a5f3fc'];

  _initParticles() {
    const w = this.canvas.width  || 400;
    const h = this.canvas.height || 600;
    for (let i = 0; i < 40; i++) {
      this._particles.push(this._makeParticle(w, h, true));
    }
  }

  _makeParticle(w, h, initial = false) {
    return {
      x:       Math.random() * w,
      y:       initial ? Math.random() * h : h + 4,
      vx:      (Math.random() - 0.5) * 0.30,
      vy:      -(0.20 + Math.random() * 0.38),
      size:    0.7 + Math.random() * 1.4,
      opacity: 0.07 + Math.random() * 0.16,
      color:   Game._DUST_COLORS[Math.floor(Math.random() * Game._DUST_COLORS.length)],
      life:    initial ? Math.floor(Math.random() * 260) : 0,
      maxLife: 220 + Math.floor(Math.random() * 280),
      rot:     Math.random() * Math.PI * 2,
      rotV:    (Math.random() - 0.5) * 0.025,
    };
  }

  _updateParticles() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.rotV;
      p.life++;
      const fade = p.life < 40
        ? p.life / 40
        : p.life > p.maxLife - 40
          ? (p.maxLife - p.life) / 40
          : 1;
      const alpha = p.opacity * fade;
      if (alpha > 0.003) {
        this._drawTinyDiamond(ctx, p.x, p.y, p.size, p.color, alpha, p.rot);
      }
      if (p.life >= p.maxLife || p.y < -8) {
        const np = this._makeParticle(w, h, false);
        np.x = Math.random() * w;
        this._particles[i] = np;
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawTinyDiamond(ctx, x, y, r, color, alpha, rot) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0,  -r);
    ctx.lineTo(r,   0);
    ctx.lineTo(0,   r);
    ctx.lineTo(-r,  0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Tier 2: Placement burst
  _spawnBurst(cellIdx) {
    const cs    = this._cellSize();
    const col   = cellIdx % this.level.width;
    const row   = Math.floor(cellIdx / this.level.width);
    const cx    = this.offsetX + col * cs + cs / 2;
    const cy    = this.offsetY + row * cs + cs / 2;
    const color = this.paletteMap.get(this.level.cells[cellIdx]) ?? '#ffffff';

    // 12 mini-diamond burst
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const speed = 1.4 + Math.random() * 2.2;
      this._burstParticles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vDamp: 0.94,
        size: 1.5 + Math.random() * 2.0,
        color,
        life: 0,
        maxLife: 28 + Math.floor(Math.random() * 18),
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3,
        type: 'diamond',
      });
    }

    // 3 light ray streaks
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 2;
      this._burstParticles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vDamp: 0.90,
        size: 5 + Math.random() * 4,
        color: '#ffffff',
        life: 0,
        maxLife: 16,
        rot: angle,
        rotV: 0,
        type: 'ray',
      });
    }
  }

  // Tier 3: Group completion cascade
  _spawnGroupCascade(colorId) {
    const cs    = this._cellSize();
    const cells = this.level.cells;
    const w     = this.level.width;
    const color = this.paletteMap.get(colorId) ?? '#ffffff';
    const gold  = '#fde68a';
    const indices = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === colorId) indices.push(i);
    }
    for (let n = 0; n < 40; n++) {
      const idx = indices[Math.floor(Math.random() * indices.length)];
      const col = idx % w;
      const row = Math.floor(idx / w);
      const cx  = this.offsetX + col * cs + cs / 2;
      const cy  = this.offsetY + row * cs + cs / 2;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 3.5;
      this._burstParticles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        vDamp: 0.92,
        size: 2.5 + Math.random() * 2.5,
        color: Math.random() < 0.5 ? color : gold,
        life: 0,
        maxLife: 50 + Math.floor(Math.random() * 22),
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.18,
        type: 'diamond',
      });
    }
  }

  _updateBurstParticles() {
    const { ctx } = this;
    for (let i = this._burstParticles.length - 1; i >= 0; i--) {
      const p = this._burstParticles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vx *= p.vDamp;
      p.vy *= p.vDamp;
      p.vy += 0.06; // gentle gravity
      p.rot += p.rotV;
      p.life++;

      const fade = p.life < 4
        ? p.life / 4
        : 1 - (p.life / p.maxLife);
      const alpha = Math.max(0, fade);

      if (alpha > 0.01) {
        if (p.type === 'ray') {
          // Elongated light streak
          ctx.save();
          ctx.globalAlpha = alpha * 0.7;
          ctx.strokeStyle = p.color;
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(
            p.x - Math.cos(p.rot) * p.size * 3,
            p.y - Math.sin(p.rot) * p.size * 3
          );
          ctx.stroke();
          ctx.restore();
        } else {
          this._drawTinyDiamond(ctx, p.x, p.y, p.size, p.color, alpha, p.rot);
        }
      }

      if (p.life >= p.maxLife) {
        this._burstParticles.splice(i, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ─── Shine Sparkles ────────────────────────────────────────────────────────

  _updateShineSparkles(now) {
    const { ctx } = this;
    const cs = this._cellSize();

    // Spawn a sparkle on a random filled cell every 700–2000 ms
    if (now >= this._nextShineTime && this.filled.size > 0) {
      this._nextShineTime = now + 700 + Math.random() * 1300;
      const filledArr = [...this.filled];
      const idx = filledArr[Math.floor(Math.random() * filledArr.length)];
      const col = idx % this.level.width;
      const row = Math.floor(idx / this.level.width);
      this._shineSparkles.push({ col, row, startTime: now, duration: 900 + Math.random() * 700 });
    }

    // Draw and age sparkles
    for (let i = this._shineSparkles.length - 1; i >= 0; i--) {
      const sp = this._shineSparkles[i];
      const progress = (now - sp.startTime) / sp.duration;
      if (progress >= 1) { this._shineSparkles.splice(i, 1); continue; }

      let alpha = progress < 0.30 ? progress / 0.30
                : progress < 0.70 ? 1
                : (1 - progress) / 0.30;
      alpha = Math.max(0, Math.min(1, alpha)) * 0.90;

      const cx = this.offsetX + sp.col * cs + cs / 2;
      const cy = this.offsetY + sp.row * cs + cs / 2;
      const r  = cs * 0.38;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = Math.max(0.5, cs * 0.036);
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur  = cs * 0.50;
      for (let a = 0; a < 4; a++) {
        const angle = (a / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r * 0.18, cy + Math.sin(angle) * r * 0.18);
        ctx.lineTo(cx + Math.cos(angle) * r,         cy + Math.sin(angle) * r);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, cs * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
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
    const { width, height, cells } = level;
    const cs  = this._cellSize();
    const now = Date.now();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Tier 1: ambient crystal dust
    if (this._particlesEnabled) this._updateParticles();

    const ox = this.offsetX;
    const oy = this.offsetY;

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx    = cellToIdx(col, row, width);
        const target = cells[idx];
        const x      = ox + col * cs;
        const y      = oy + row * cs;

        // Empty/transparent cells — skip entirely, show only background
        if (target === 0) continue;

        const flash      = this._flashes.get(idx);
        const isFlashing = flash && flash.until > now;

        if (this.filled.has(idx)) {
          // Filled diamond — with optional entrance scale animation
          const color     = this.paletteMap.get(target) ?? '#888';
          const enterAnim = this._cellEnter.get(idx);
          let enterScale  = 1;
          if (enterAnim) {
            const t = Math.min(1, (now - enterAnim.start) / enterAnim.duration);
            if (t < 1) {
              const c4 = (2 * Math.PI) / 3;
              enterScale = t === 0 ? 0
                : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
              enterScale = Math.max(0.01, enterScale);
            } else {
              this._cellEnter.delete(idx);
            }
          }
          this._drawDiamond(ctx, x, y, cs, color, isFlashing && flash.correct, enterScale);
        } else {
          // Unfilled numbered cell — ghost diamond outline + colour-tinted number
          const color = this.paletteMap.get(target) ?? '#888';
          const cx2 = x + cs / 2, cy2 = y + cs / 2;
          const hw2 = cs * 0.40, hh2 = cs * 0.40;

          // Ghost diamond outline
          ctx.save();
          ctx.strokeStyle = hexToRgba(color, 0.28);
          ctx.lineWidth   = 0.8;
          ctx.beginPath();
          ctx.moveTo(cx2,       cy2 - hh2);
          ctx.lineTo(cx2 + hw2, cy2);
          ctx.lineTo(cx2,       cy2 + hh2);
          ctx.lineTo(cx2 - hw2, cy2);
          ctx.closePath();
          ctx.stroke();

          // Wrong-colour flash
          if (isFlashing && !flash.correct) {
            ctx.fillStyle = 'rgba(239,68,68,0.30)';
            ctx.beginPath();
            ctx.moveTo(cx2,       cy2 - hh2);
            ctx.lineTo(cx2 + hw2, cy2);
            ctx.lineTo(cx2,       cy2 + hh2);
            ctx.lineTo(cx2 - hw2, cy2);
            ctx.closePath();
            ctx.fill();
          }

          ctx.restore();

          // Number hint
          if (cs >= 14) {
            ctx.fillStyle    = hexToRgba(color, 0.80);
            ctx.font         = `bold ${Math.max(9, Math.round(cs * 0.44))}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(target), cx2, cy2);
          }
        }
      }
    }

    // Color group completion flash overlay
    for (const [colorId, gFlash] of this._groupFlashes) {
      if (gFlash.until > now) {
        const t     = (gFlash.until - now) / 1000;
        const alpha = t * 0.28;
        const color = this.paletteMap.get(colorId) ?? '#fff';
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] === colorId && this.filled.has(i)) {
            const row = Math.floor(i / width);
            const col = i % width;
            ctx.fillStyle = hexToRgba(color, alpha);
            ctx.fillRect(ox + col * cs, oy + row * cs, cs, cs);
          }
        }
      } else {
        this._groupFlashes.delete(colorId);
      }
    }

    // Clean expired flashes
    for (const [idx, f] of this._flashes) {
      if (f.until <= now) this._flashes.delete(idx);
    }

    // Tier 2 & 3: burst + cascade particles (drawn on top of grid)
    if (this._particlesEnabled) this._updateBurstParticles();

    // Shine sparkles on random filled diamonds
    if (this._particlesEnabled && this.filled.size > 0) this._updateShineSparkles(now);
  }

  /**
   * Draw a multi-facet jewel-like diamond in a cell.
   * 6-step pipeline: glow → radial body → facets → rim light → highlight → glitter
   * @param {number} scale  Optional entrance scale (1 = normal)
   */
  _drawDiamond(ctx, x, y, cs, color, glitter = false, scale = 1) {
    const cx = x + cs / 2;
    const cy = y + cs / 2;
    const hw = cs * 0.42;
    const hh = cs * 0.42;

    ctx.save();

    if (scale !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    // ── Helper: clip to diamond shape ──────────────────────────────────────────
    function diamondPath() {
      ctx.beginPath();
      ctx.moveTo(cx,      cy - hh);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx,      cy + hh);
      ctx.lineTo(cx - hw, cy);
      ctx.closePath();
    }

    // Step 1 — Outer glow (shadow pass)
    ctx.shadowColor = hexToRgba(color, 0.7);
    ctx.shadowBlur  = cs * 0.5;
    diamondPath();
    ctx.fillStyle = hexToRgba(color, 0.01); // near-invisible fill, just to emit shadow
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // Step 2 — Radial body gradient (off-center highlight)
    diamondPath();
    const grad = ctx.createRadialGradient(
      cx - hw * 0.22, cy - hh * 0.30, 0,
      cx, cy, hw * 1.15
    );
    grad.addColorStop(0,    shiftColor(color,  0.62));
    grad.addColorStop(0.28, shiftColor(color,  0.20));
    grad.addColorStop(0.58, color);
    grad.addColorStop(0.82, shiftColor(color, -0.22));
    grad.addColorStop(1,    shiftColor(color, -0.45));
    ctx.fillStyle = grad;
    ctx.fill();

    // Step 3 — 4 facet planes (clip to diamond)
    ctx.save();
    diamondPath();
    ctx.clip();

    // Upper-left facet (pale brightened)
    const ulGrad = ctx.createLinearGradient(cx - hw, cy - hh, cx, cy);
    ulGrad.addColorStop(0, hexToRgba(shiftColor(color, 0.45), 0.55));
    ulGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ulGrad;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh); ctx.lineTo(cx - hw, cy); ctx.lineTo(cx, cy); ctx.closePath();
    ctx.fill();

    // Upper-right facet (white shimmer)
    const urGrad = ctx.createLinearGradient(cx + hw, cy - hh, cx, cy);
    urGrad.addColorStop(0, 'rgba(255,255,255,0.38)');
    urGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = urGrad;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy); ctx.closePath();
    ctx.fill();

    // Lower-left facet (darkened)
    ctx.fillStyle = hexToRgba(shiftColor(color, -0.30), 0.62);
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx, cy); ctx.closePath();
    ctx.fill();

    // Lower-right facet (darkest)
    ctx.fillStyle = hexToRgba(shiftColor(color, -0.42), 0.68);
    ctx.beginPath();
    ctx.moveTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx, cy); ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Step 4 — Prismatic rim light (stroke with hue-rotated gradient)
    diamondPath();
    const rimGrad = ctx.createLinearGradient(cx - hw, cy, cx + hw, cy);
    rimGrad.addColorStop(0,    rotateHue(color,  60));
    rimGrad.addColorStop(0.33, rotateHue(color, 120));
    rimGrad.addColorStop(0.66, rotateHue(color, -60));
    rimGrad.addColorStop(1,    rotateHue(color, -120));
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth   = Math.max(0.5, cs * 0.032);
    ctx.globalAlpha = 0.50;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Step 5 — Top highlight capsule (schlieren effect)
    ctx.save();
    diamondPath();
    ctx.clip();
    if (ctx.filter !== undefined) ctx.filter = 'blur(1px)';
    ctx.globalAlpha = 0.42;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    const hx = cx - hw * 0.12;
    const hy = cy - hh * 0.52;
    const hr = cs * 0.11;
    ctx.ellipse(hx, hy, hr, hr * 0.45, -Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();
    if (ctx.filter !== undefined) ctx.filter = 'none';
    ctx.restore();

    // Step 6 — Glitter burst (just-placed sparkle)
    if (glitter) {
      ctx.shadowBlur  = cs * 0.65;
      ctx.shadowColor = '#ffffff';

      // 8 radiating star lines
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const len   = cs * 0.52;
        const lineGrad = ctx.createLinearGradient(
          cx, cy,
          cx + Math.cos(angle) * len,
          cy + Math.sin(angle) * len
        );
        lineGrad.addColorStop(0,   'rgba(255,255,255,0.85)');
        lineGrad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
        lineGrad.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth   = Math.max(0.8, cs * 0.045);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 4 secondary diamond sparkles at 45° offset
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const dist  = cs * 0.38;
        const sr    = cs * 0.07;
        const sx    = cx + Math.cos(angle) * dist;
        const sy    = cy + Math.sin(angle) * dist;
        ctx.fillStyle   = 'rgba(255,255,255,0.88)';
        ctx.globalAlpha = 0.88;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, -sr); ctx.lineTo(sr * 0.5, 0);
        ctx.lineTo(0,  sr); ctx.lineTo(-sr * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // Central bloom
      ctx.shadowBlur  = cs * 0.8;
      ctx.shadowColor = '#ffffff';
      ctx.fillStyle   = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, cs * 0.1, 0, Math.PI * 2);
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
    c.addEventListener('pointerdown',   this._onPointerDown);
    c.addEventListener('pointermove',   this._onPointerMove);
    c.addEventListener('pointerup',     this._onPointerUp);
    c.addEventListener('pointercancel', this._onPointerUp);
    c.addEventListener('wheel',         this._onWheel, { passive: false });
  }

  _unbindEvents() {
    const c = this.canvas;
    c.removeEventListener('pointerdown',   this._onPointerDown);
    c.removeEventListener('pointermove',   this._onPointerMove);
    c.removeEventListener('pointerup',     this._onPointerUp);
    c.removeEventListener('pointercancel', this._onPointerUp);
    c.removeEventListener('wheel',         this._onWheel);
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
      this._panStart   = { ...pos, ox: this.offsetX, oy: this.offsetY };
      this._isPanning  = false;
      this._tapPos     = pos;
    } else if (this._pointers.size === 2) {
      const pts = [...this._pointers.values()];
      this._lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  }

  _onPointerMove(e) {
    e.preventDefault();
    const pos = this._canvasPos(e);
    this._pointers.set(e.pointerId, pos);

    if (this._pointers.size === 2) {
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
    const pos    = this._canvasPos(e);
    const wasPane = this._isPanning;
    this._pointers.delete(e.pointerId);

    if (this._pointers.size < 2) this._lastPinchDist = null;

    if (this._pointers.size === 0) {
      if (!wasPane) {
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
  const ctx = canvas.getContext('2d');
  const map = new Map(palette.map(p => [p.id, p.color]));

  // Crop to art bounding box so the art is centered in the thumbnail
  let r0 = height, r1 = 0, c0 = width, c1 = 0;
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      if (cells[r * width + c] !== 0) {
        r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      }
  if (r0 > r1) { r0 = 0; r1 = height - 1; c0 = 0; c1 = width - 1; }

  const artW = c1 - c0 + 1;
  const artH = r1 - r0 + 1;
  // cs sized so the art fills the canvas, then offset to center
  const cs = Math.min(canvas.width / artW, canvas.height / artH);
  const ox = Math.round((canvas.width  - artW * cs) / 2);
  const oy = Math.round((canvas.height - artH * cs) / 2);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101620';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const v = cells[r * width + c];
      if (v === 0) continue;
      ctx.fillStyle = map.get(v) ?? '#888';
      ctx.fillRect(ox + (c - c0) * cs, oy + (r - r0) * cs, cs, cs);
    }
  }
}

/**
 * Draw one diamond cell onto ctx at (x,y) with cell-size cs.
 * Standalone version of Game._drawDiamond (no entrance scale).
 */
export function drawDiamondCell(ctx, x, y, cs, color) {
  const cx = x + cs / 2;
  const cy = y + cs / 2;
  const hw = cs * 0.42;
  const hh = cs * 0.42;

  function diamondPath() {
    ctx.beginPath();
    ctx.moveTo(cx,      cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx,      cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  ctx.save();

  // Outer glow
  ctx.shadowColor = hexToRgba(color, 0.7);
  ctx.shadowBlur  = cs * 0.5;
  diamondPath();
  ctx.fillStyle = hexToRgba(color, 0.01);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  // Radial body
  diamondPath();
  const grad = ctx.createRadialGradient(cx - hw*0.22, cy - hh*0.30, 0, cx, cy, hw*1.15);
  grad.addColorStop(0,    shiftColor(color,  0.62));
  grad.addColorStop(0.28, shiftColor(color,  0.20));
  grad.addColorStop(0.58, color);
  grad.addColorStop(0.82, shiftColor(color, -0.22));
  grad.addColorStop(1,    shiftColor(color, -0.45));
  ctx.fillStyle = grad;
  ctx.fill();

  // Facets
  ctx.save();
  diamondPath();
  ctx.clip();
  const ulGrad = ctx.createLinearGradient(cx-hw, cy-hh, cx, cy);
  ulGrad.addColorStop(0, hexToRgba(shiftColor(color, 0.45), 0.55));
  ulGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = ulGrad;
  ctx.beginPath(); ctx.moveTo(cx,cy-hh); ctx.lineTo(cx-hw,cy); ctx.lineTo(cx,cy); ctx.closePath(); ctx.fill();
  const urGrad = ctx.createLinearGradient(cx+hw, cy-hh, cx, cy);
  urGrad.addColorStop(0, 'rgba(255,255,255,0.38)');
  urGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = urGrad;
  ctx.beginPath(); ctx.moveTo(cx,cy-hh); ctx.lineTo(cx+hw,cy); ctx.lineTo(cx,cy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = hexToRgba(shiftColor(color,-0.30), 0.62);
  ctx.beginPath(); ctx.moveTo(cx-hw,cy); ctx.lineTo(cx,cy+hh); ctx.lineTo(cx,cy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = hexToRgba(shiftColor(color,-0.45), 0.55);
  ctx.beginPath(); ctx.moveTo(cx+hw,cy); ctx.lineTo(cx,cy+hh); ctx.lineTo(cx,cy); ctx.closePath(); ctx.fill();
  ctx.restore();

  // Highlight
  const hlGrad = ctx.createRadialGradient(cx-hw*0.28, cy-hh*0.32, 0, cx-hw*0.28, cy-hh*0.32, hw*0.52);
  hlGrad.addColorStop(0, 'rgba(255,255,255,0.82)');
  hlGrad.addColorStop(0.55,'rgba(255,255,255,0.12)');
  hlGrad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = hlGrad;
  ctx.fill();

  ctx.restore();
}

/**
 * Render a level as full diamond art (all non-zero cells = actual diamonds).
 */
export function renderDiamondPreview(canvas, level) {
  const { width, height, cells, palette } = level;
  const ctx = canvas.getContext('2d');
  const cs  = canvas.width / width;
  const map = new Map(palette.map(p => [p.id, p.color]));

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const v = cells[row * width + col];
      if (v === 0) continue;
      const color = map.get(v) ?? '#888';
      drawDiamondCell(ctx, col * cs, row * cs, cs, color);
    }
  }
}

/**
 * Start a sparkle animation loop on a canvas that already has diamond art rendered.
 * Returns a stop() function.
 */
export function startSparkleAnimation(canvas, level) {
  const { width, height, cells } = level;
  const cs = canvas.width / width;

  // Collect filled cell positions
  const filled = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 0) filled.push(i);
  }
  if (filled.length === 0) return () => {};

  // Cache the base diamond art so sparkles don't permanently write on it
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width  = canvas.width;
  baseCanvas.height = canvas.height;
  baseCanvas.getContext('2d').drawImage(canvas, 0, 0);

  // Active sparkles: { col, row, t, duration }
  const sparkles = [];
  let last = 0;
  let rafId = null;
  let running = true;

  function drawStar(ctx, x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.5, r * 0.15);
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = r * 2;
    // 4-pointed star
    for (let a = 0; a < 4; a++) {
      const angle = (a / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * r * 0.18, y + Math.sin(angle) * r * 0.18);
      ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
      ctx.stroke();
    }
    // Tiny center dot
    ctx.beginPath();
    ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  function frame(ts) {
    if (!running) return;
    const dt = ts - last;
    last = ts;

    // Restore base art each frame so sparkles don't accumulate
    const ctx2 = canvas.getContext('2d');
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    ctx2.drawImage(baseCanvas, 0, 0);

    // Spawn new sparkle every ~1.8s (randomly between 1–3s)
    if (sparkles.length < 4 && Math.random() < dt / 1800) {
      const idx = filled[Math.floor(Math.random() * filled.length)];
      const col = idx % width;
      const row = Math.floor(idx / width);
      sparkles.push({ col, row, t: 0, duration: 900 + Math.random() * 600 });
    }

    // We only need to overdraw sparkle cells — no full re-render needed
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const sp = sparkles[i];
      sp.t += dt;
      const progress = sp.t / sp.duration;
      // Fade in 0→0.3, hold 0.3→0.7, fade out 0.7→1
      let alpha;
      if (progress < 0.3) alpha = progress / 0.3;
      else if (progress < 0.7) alpha = 1;
      else alpha = (1 - progress) / 0.3;
      alpha = Math.max(0, Math.min(1, alpha)) * 0.9;

      const cx = sp.col * cs + cs / 2;
      const cy = sp.row * cs + cs / 2;
      drawStar(canvas.getContext('2d'), cx, cy, cs * 0.38, alpha);

      if (sp.t >= sp.duration) sparkles.splice(i, 1);
    }

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => { running = false; if (rafId) cancelAnimationFrame(rafId); };
}
