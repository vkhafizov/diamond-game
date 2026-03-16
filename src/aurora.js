/**
 * Aurora background animation.
 * Renders a full-screen animated aurora/nebula effect on a fixed canvas
 * that sits behind the main app. Runs its own rAF loop independently.
 */

let _canvas = null;
let _ctx    = null;
let _rafId  = null;
let _paused = false;
let _t      = 0;
let _stars  = [];
let _resizeObserver = null;

// 4 aurora blob configs: { color, freqX, freqY, phaseX, phaseY, ampX, ampY, period }
const BLOBS = [
  { r: 109, g:  40, b: 217, freqX: 1/18, freqY: 1/23, phaseX: 0,         phaseY: 0,         ampX: 0.32, ampY: 0.28 },
  { r:   6, g: 182, b: 212, freqX: 1/23, freqY: 1/31, phaseX: Math.PI,   phaseY: Math.PI/2, ampX: 0.28, ampY: 0.35 },
  { r: 219, g:  39, b: 119, freqX: 1/31, freqY: 1/18, phaseX: Math.PI/3, phaseY: Math.PI,   ampX: 0.38, ampY: 0.22 },
  { r: 217, g: 119, b:   6, freqX: 1/41, freqY: 1/29, phaseX: Math.PI*2, phaseY: Math.PI/4, ampX: 0.22, ampY: 0.30 },
];

function _initStars(w, h) {
  _stars = [];
  const count = Math.floor(Math.min(w * h / 6000, 160));
  for (let i = 0; i < count; i++) {
    _stars.push({
      x:        Math.random() * w,
      y:        Math.random() * h,
      r:        0.5 + Math.random() * 1.0,
      baseAlpha: 0.05 + Math.random() * 0.25,
      freq:     1 / (4 + Math.random() * 7),
      phase:    Math.random() * Math.PI * 2,
    });
  }
}

function _drawFrame() {
  if (!_canvas || !_ctx) return;
  const w = _canvas.width;
  const h = _canvas.height;
  _t += 1 / 60;

  _ctx.clearRect(0, 0, w, h);

  // Draw aurora blobs
  for (const b of BLOBS) {
    const cx = w * (0.5 + Math.sin(_t * b.freqX * Math.PI * 2 + b.phaseX) * b.ampX);
    const cy = h * (0.5 + Math.cos(_t * b.freqY * Math.PI * 2 + b.phaseY) * b.ampY);
    const rx = Math.min(w, h) * (0.42 + Math.sin(_t * 0.07 + b.phaseX) * 0.06);
    const ry = Math.min(w, h) * (0.38 + Math.cos(_t * 0.05 + b.phaseY) * 0.06);
    const grad = _ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0,   `rgba(${b.r},${b.g},${b.b},0.13)`);
    grad.addColorStop(0.5, `rgba(${b.r},${b.g},${b.b},0.06)`);
    grad.addColorStop(1,   `rgba(${b.r},${b.g},${b.b},0)`);
    _ctx.save();
    _ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    _ctx.fillStyle = grad;
    _ctx.beginPath();
    _ctx.arc(
      cx * (Math.max(rx, ry) / rx),
      cy * (Math.max(rx, ry) / ry),
      Math.max(rx, ry), 0, Math.PI * 2
    );
    _ctx.fill();
    _ctx.restore();
  }

  // Draw stars
  for (const s of _stars) {
    const alpha = s.baseAlpha * (0.5 + 0.5 * Math.sin(_t * s.freq * Math.PI * 2 + s.phase));
    _ctx.globalAlpha = alpha;
    _ctx.fillStyle = '#ffffff';
    _ctx.beginPath();
    _ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    _ctx.fill();
  }
  _ctx.globalAlpha = 1;
}

function _loop() {
  if (_paused) return;
  _drawFrame();
  _rafId = requestAnimationFrame(_loop);
}

export function initAurora(canvasEl) {
  _canvas = canvasEl;
  _ctx    = canvasEl.getContext('2d');

  function resize() {
    _canvas.width  = window.innerWidth;
    _canvas.height = window.innerHeight;
    _initStars(_canvas.width, _canvas.height);
  }
  resize();

  window.addEventListener('resize', resize);

  _paused = false;
  _loop();
}

export function pauseAurora() {
  _paused = true;
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
}

export function resumeAurora() {
  if (_paused) {
    _paused = false;
    _loop();
  }
}
