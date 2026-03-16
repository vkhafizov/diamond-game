/**
 * Lightweight Web Audio helpers for diamond placement feedback.
 */

let _ctx = null;

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

/** Short percussive click when placing a diamond correctly. */
export function playPlace() {
  try {
    const ac   = getCtx();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(450, ac.currentTime + 0.06);
    gain.gain.setValueAtTime(0.1, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.12);
  } catch (_) {}
}

/** Ascending chime when a full color group is placed. */
export function playGroupComplete() {
  try {
    const ac = getCtx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ac.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch (_) {}
}
