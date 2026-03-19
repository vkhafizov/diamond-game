/**
 * Meditative crystal sound system for Diamond Painting.
 * 4 layers: ambient drone, crystal placement ping, group complete arpeggio,
 * level complete ceremony.
 *
 * Drone design:
 *  • A major chord in mid-register: A3 / E4 / A4 / C#5 (220 / 330 / 440 / 554 Hz)
 *    — no sub-bass, no threat frequencies, warm and open
 *  • One sine oscillator per voice + tiny triangle harmonic for crystal warmth
 *  • NO binaural offset — that caused rapid monaural beating on speakers
 *  • One very gentle breathing LFO per voice (±3 % depth, 15–25 s cycle)
 *    at different rates so voices never pulse in sync
 *  • Voices bloom one by one over ~8 s for a crystalline opening
 */

let _ctx           = null;
let _musicGainNode = null;
let _sfxGainNode   = null;
let _droneNodes    = [];

let _musicEnabled = true;
let _sfxEnabled   = true;
let _musicVolume  = 0.5;
let _sfxVolume    = 0.7;

// ─── Public toggles & volume ──────────────────────────────────────────────────

export function setMusicEnabled(val) {
  _musicEnabled = Boolean(val);
  if (!_musicEnabled) stopAmbientDrone();
}

export function setSfxEnabled(val) {
  _sfxEnabled = Boolean(val);
}

export function setMusicVolume(val) {
  _musicVolume = Math.max(0, Math.min(1, val));
  if (_musicGainNode) _musicGainNode.gain.value = _musicVolume;
}

export function setSfxVolume(val) {
  _sfxVolume = Math.max(0, Math.min(1, val));
  if (_sfxGainNode) _sfxGainNode.gain.value = _sfxVolume;
}

// ─── Audio context ────────────────────────────────────────────────────────────

function getCtx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();

    _musicGainNode = _ctx.createGain();
    _musicGainNode.gain.value = _musicVolume;
    _musicGainNode.connect(_ctx.destination);

    _sfxGainNode = _ctx.createGain();
    _sfxGainNode.gain.value = _sfxVolume;
    _sfxGainNode.connect(_ctx.destination);
  }
  return _ctx;
}

// Pentatonic scale frequencies (C pentatonic)
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];

// ─── Ambient Drone ────────────────────────────────────────────────────────────

/**
 * Pure A-major pad — four sine voices that fade in one by one.
 *
 * Each voice has ONE breathing LFO (±3 % amplitude only) at a different
 * slow rate (15–26 s cycle). They are never in sync, so there is no
 * periodic pumping or beating — just a gentle, living stillness.
 */


export async function startAmbientDrone() {
  if (!_musicEnabled) return;
  try {
    if (_droneNodes.length) return;

    const ac = getCtx();
    if (ac.state === 'suspended') await ac.resume();

    const chords = [
      [220, 277, 330, 440],
      [220, 262, 330, 392],
      [196, 247, 294, 370],
      [220, 247, 330, 392],
    ];

    let nextTime = ac.currentTime;

    function playChord(time) {
      const chord = chords[Math.floor(Math.random() * chords.length)];

      chord.forEach((freq, i) => {
        const osc1 = ac.createOscillator();
        const osc2 = ac.createOscillator();
        const gain = ac.createGain();
        const filter = ac.createBiquadFilter();
        const pan = ac.createStereoPanner();

        osc1.type = 'sine';
        osc2.type = 'sine';

        osc1.frequency.value = freq;
        osc2.frequency.value = freq;

        osc1.detune.value = -2;
        osc2.detune.value = 2;

        filter.type = 'lowpass';
        filter.frequency.value = 700;
        filter.Q.value = 0.2;

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.045, time + 2.5);
        gain.gain.linearRampToValueAtTime(0.03, time + 7);
        gain.gain.linearRampToValueAtTime(0.0, time + 11);

        pan.pan.value = (i - 1.5) * 0.25;

        const air = ac.createOscillator();
        const airGain = ac.createGain();

        air.type = 'sine';
        air.frequency.value = freq * 4;

        airGain.gain.setValueAtTime(0, time);
        airGain.gain.linearRampToValueAtTime(0.006, time + 3);
        airGain.gain.linearRampToValueAtTime(0, time + 11);

        osc1.connect(filter);
        osc2.connect(filter);
        air.connect(filter);

        filter.connect(gain);
        gain.connect(pan);
        pan.connect(_musicGainNode);

        osc1.start(time);
        osc2.start(time);
        air.start(time);

        osc1.stop(time + 11);
        osc2.stop(time + 11);
        air.stop(time + 11);

        _droneNodes.push(osc1, osc2, air, gain, filter, pan, airGain);
      });
    }

    function schedule() {
      if (!_musicEnabled) return;

      playChord(nextTime);
      nextTime += 5.5 + Math.random() * 1.5;

      setTimeout(schedule, 4000);
    }

    schedule();

  } catch (_) {}
}

/** Stop the ambient drone and release all nodes. */
export function stopAmbientDrone() {
  try {
    _droneNodes.forEach(n => {
      try {
        if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) {
          n.stop();
        }
        n.disconnect();
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
    osc1.type            = 'sine';
    osc1.frequency.value = freq;
    gain1.gain.setValueAtTime(0.10, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc1.connect(gain1);
    gain1.connect(_sfxGainNode);
    osc1.start(t);
    osc1.stop(t + 0.6);

    // Sub-harmonic shimmer — triangle one octave up, brief
    const osc2  = ac.createOscillator();
    const gain2 = ac.createGain();
    osc2.type            = 'triangle';
    osc2.frequency.value = freq * 2;
    gain2.gain.setValueAtTime(0.028, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc2.connect(gain2);
    gain2.connect(_sfxGainNode);
    osc2.start(t);
    osc2.stop(t + 0.2);

    // Crystal clink — bandpass noise burst
    const bufSize  = Math.ceil(ac.sampleRate * 0.04);
    const buf      = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data     = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise    = ac.createBufferSource();
    const bandpass = ac.createBiquadFilter();
    const noiseG   = ac.createGain();
    noise.buffer             = buf;
    bandpass.type            = 'bandpass';
    bandpass.frequency.value = freq * 1.5;
    bandpass.Q.value         = 10;
    noiseG.gain.setValueAtTime(0.038, t);
    noiseG.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    noise.connect(bandpass);
    bandpass.connect(noiseG);
    noiseG.connect(_sfxGainNode);
    noise.start(t);
    noise.stop(t + 0.05);
  } catch (_) {}
}

// ─── Group Complete Arpeggio ──────────────────────────────────────────────────

/** Ascending crystal arpeggio when a full colour group is placed. */
export function playGroupComplete() {
  if (!_sfxEnabled) return;
  try {
    const ac    = getCtx();
    if (ac.state === 'suspended') ac.resume();
    const notes = [261.63, 329.63, 392.00, 493.88, 523.25];
    notes.forEach((freq, i) => {
      const t = ac.currentTime + i * 0.12;
      ['triangle', 'sine'].forEach((type, j) => {
        const osc  = ac.createOscillator();
        const gain = ac.createGain();
        osc.type            = type;
        osc.frequency.value = freq * (j === 0 ? 1 : 2);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(j === 0 ? 0.08 : 0.032, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
        osc.connect(gain);
        gain.connect(_sfxGainNode);
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
    const ac    = getCtx();
    if (ac.state === 'suspended') ac.resume();
    const base  = 261.63;
    const scale = [1, 1.125, 1.25, 1.5, 1.667, 2, 2.25, 2.5, 3, 3.333, 4];

    scale.forEach((ratio, i) => {
      const t    = ac.currentTime + i * 0.16;
      const freq = base * ratio;
      const osc  = ac.createOscillator();
      const g    = ac.createGain();
      osc.type            = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.065, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      osc.connect(g);
      g.connect(_sfxGainNode);
      osc.start(t);
      osc.stop(t + 0.7);
    });

    // Reverb tail — 18 quiet harmonics
    for (let i = 0; i < 18; i++) {
      const t    = ac.currentTime + 1.7 + Math.random() * 1.2;
      const freq = base * (1 + Math.random() * 7);
      const osc  = ac.createOscillator();
      const g    = ac.createGain();
      osc.type            = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      osc.connect(g);
      g.connect(_sfxGainNode);
      osc.start(t);
      osc.stop(t + 0.9);
    }
  } catch (_) {}
}
