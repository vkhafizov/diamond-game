/**
 * Meditative crystal sound system for Diamond Painting.
 * 4 layers: ambient drone, crystal placement ping, group complete arpeggio,
 * level complete ceremony.
 */

let _ctx = null;
let _droneNodes = [];

let _musicEnabled = true;
let _sfxEnabled   = true;

/** Toggle ambient music on/off. */
export function setMusicEnabled(val) {
  _musicEnabled = Boolean(val);
  if (!_musicEnabled) stopAmbientDrone();
}

/** Toggle SFX on/off (placement pings, arpeggios, level complete). */
export function setSfxEnabled(val) {
  _sfxEnabled = Boolean(val);
}

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

// Pentatonic scale frequencies (C pentatonic)
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];

// ─── Ambient Drone ────────────────────────────────────────────────────────────

/** Start a quiet 3-voice meditative pad. Call once on first user interaction. */
export function startAmbientDrone() {
  if (!_musicEnabled) return;
  try {
    if (_droneNodes.length) return; // already running
    const ac = getCtx();
    if (ac.state === 'suspended') ac.resume();

    // 3-voice: root A1 + fifth E2 + octave A2
    const voices = [
      { freq: 55.00,  detune: -4 },
      { freq: 82.41,  detune: +4 },
      { freq: 110.00, detune: -2 },
    ];

    voices.forEach(({ freq, detune }) => {
      const osc   = ac.createOscillator();
      const gain  = ac.createGain();
      const filt  = ac.createBiquadFilter();
      const lfo   = ac.createOscillator();
      const lfoG  = ac.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value    = detune;

      filt.type = 'lowpass';
      filt.frequency.value = 320;

      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(0.016, ac.currentTime + 3.0);

      // Slow tremolo
      lfo.type = 'sine';
      lfo.frequency.value = 0.09 + Math.random() * 0.04;
      lfoG.gain.value = 0.006;
      lfo.connect(lfoG);
      lfoG.connect(gain.gain);
      lfo.start();

      osc.connect(filt);
      filt.connect(gain);
      gain.connect(ac.destination);
      osc.start();

      _droneNodes.push(osc, gain, filt, lfo, lfoG);
    });
  } catch (_) {}
}

/** Stop the ambient drone. */
export function stopAmbientDrone() {
  try {
    const ac = getCtx();
    _droneNodes.forEach(n => {
      try {
        if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) {
          n.stop();
        }
      } catch (_) {}
    });
    _droneNodes = [];
  } catch (_) {}
}

// ─── Crystal Placement Ping ───────────────────────────────────────────────────

/** Crystal ping when placing a diamond correctly. */
export function playPlace() {
  if (!_sfxEnabled) return;
  try {
    const ac   = getCtx();
    if (ac.state === 'suspended') ac.resume();
    const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
    const t    = ac.currentTime;

    // Primary sine tone — meditative bell-like decay
    const osc1  = ac.createOscillator();
    const gain1 = ac.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    gain1.gain.setValueAtTime(0.10, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc1.connect(gain1);
    gain1.connect(ac.destination);
    osc1.start(t);
    osc1.stop(t + 0.6);

    // Sub-harmonic shimmer — triangle one octave up, brief
    const osc2  = ac.createOscillator();
    const gain2 = ac.createGain();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2;
    gain2.gain.setValueAtTime(0.028, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc2.connect(gain2);
    gain2.connect(ac.destination);
    osc2.start(t);
    osc2.stop(t + 0.2);

    // Crystal clink — bandpass noise burst
    const bufSize = Math.ceil(ac.sampleRate * 0.04);
    const buf     = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data    = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise    = ac.createBufferSource();
    const bandpass = ac.createBiquadFilter();
    const noiseG   = ac.createGain();
    noise.buffer = buf;
    bandpass.type = 'bandpass';
    bandpass.frequency.value = freq * 1.5;
    bandpass.Q.value = 10;
    noiseG.gain.setValueAtTime(0.038, t);
    noiseG.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    noise.connect(bandpass);
    bandpass.connect(noiseG);
    noiseG.connect(ac.destination);
    noise.start(t);
    noise.stop(t + 0.05);
  } catch (_) {}
}

// ─── Group Complete Arpeggio ──────────────────────────────────────────────────

/** Ascending crystal arpeggio when a full color group is placed. */
export function playGroupComplete() {
  if (!_sfxEnabled) return;
  try {
    const ac    = getCtx();
    if (ac.state === 'suspended') ac.resume();
    // Major 7th arpeggio
    const notes = [261.63, 329.63, 392.00, 493.88, 523.25];
    notes.forEach((freq, i) => {
      const t = ac.currentTime + i * 0.12;
      ['triangle', 'sine'].forEach((type, j) => {
        const osc  = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq * (j === 0 ? 1 : 2);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(j === 0 ? 0.08 : 0.032, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.8);
      });
    });
  } catch (_) {}
}

// ─── Level Complete Ceremony ──────────────────────────────────────────────────

/** Rising pentatonic sweep + reverb tail when level is fully completed. */
export function playLevelComplete() {
  if (!_sfxEnabled) return;
  try {
    const ac   = getCtx();
    if (ac.state === 'suspended') ac.resume();
    const base = 261.63;
    const scale = [1, 1.125, 1.25, 1.5, 1.667, 2, 2.25, 2.5, 3, 3.333, 4];

    scale.forEach((ratio, i) => {
      const t    = ac.currentTime + i * 0.16;
      const freq = base * ratio;
      const osc  = ac.createOscillator();
      const g    = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.065, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.7);
    });

    // Reverb tail — 18 quiet harmonics
    for (let i = 0; i < 18; i++) {
      const t    = ac.currentTime + 1.7 + Math.random() * 1.2;
      const freq = base * (1 + Math.random() * 7);
      const osc  = ac.createOscillator();
      const g    = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.9);
    }
  } catch (_) {}
}
