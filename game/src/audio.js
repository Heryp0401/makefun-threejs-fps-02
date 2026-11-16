// audio.js — all sounds are synthesised with WebAudio. No audio assets,
// no network. A single shared noise buffer feeds every percussive sound.

let ctx = null;
let noiseBuf = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) {
    return false;
  }
  return true;
}

function noise(dur, filterFreq, gain, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const SHOT_PROFILE = {
  rifle: { noiseDur: 0.12, freq: 1800, gain: 0.5, thump: 140 },
  sniper: { noiseDur: 0.22, freq: 1200, gain: 0.7, thump: 90 },
  pistol: { noiseDur: 0.09, freq: 2400, gain: 0.35, thump: 180 },
};

export function playShot(weaponId) {
  const p = SHOT_PROFILE[weaponId] || SHOT_PROFILE.rifle;
  noise(p.noiseDur, p.freq, p.gain);
  tone(p.thump, 0.1, 'sine', 0.4, 60);
}

export function playDistantShot() {
  noise(0.1, 900, 0.12);
  tone(110, 0.08, 'sine', 0.12, 70);
}

export function playReload() {
  tone(1400, 0.03, 'square', 0.12);
  tone(900, 0.03, 'square', 0.12, 0, 0.18);
}

export function playDryFire() {
  tone(1800, 0.02, 'square', 0.08);
}

export function playHit() {
  tone(2200, 0.05, 'sine', 0.25);
}

export function playHeadshot() {
  tone(2600, 0.06, 'sine', 0.3);
  tone(3400, 0.08, 'sine', 0.2, 0, 0.05);
}

export function playKill() {
  tone(520, 0.09, 'triangle', 0.3, 780);
}

export function playHurt() {
  tone(160, 0.15, 'sawtooth', 0.25, 90);
}

export function playPlantBeep() {
  tone(1200, 0.07, 'square', 0.2);
}

export function playExplosion() {
  noise(0.7, 500, 0.9);
  tone(70, 0.6, 'sine', 0.7, 35);
}

export function playRoundWin() {
  tone(523, 0.12, 'triangle', 0.3);
  tone(659, 0.12, 'triangle', 0.3, 0, 0.12);
  tone(784, 0.22, 'triangle', 0.35, 0, 0.24);
}

export function playRoundLose() {
  tone(392, 0.15, 'triangle', 0.3);
  tone(330, 0.15, 'triangle', 0.3, 0, 0.15);
  tone(262, 0.3, 'triangle', 0.35, 0, 0.3);
}

export function playClick() {
  tone(1000, 0.03, 'square', 0.12);
}

export function playBuy() {
  tone(880, 0.06, 'sine', 0.25);
  tone(1320, 0.08, 'sine', 0.25, 0, 0.06);
}
