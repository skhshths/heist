// Every sound is synthesized: no audio files to load.
let ctx = null, master = null, muted = false, siren = null;

try { muted = localStorage.getItem("heist:muted") === "1"; } catch {}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("heist:muted", m ? "1" : "0"); } catch {}
  if (master) master.gain.value = m ? 0 : 0.5;
  if (m) stopSiren();
}

function tone(freq, dur, { type = "sine", vol = 0.2, at = 0, slide = null, attack = 0.005 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.15, at = 0, freq = 1200, q = 1, type = "bandpass" } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = buf;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.value = vol;
  s.connect(f).connect(g).connect(master);
  s.start(t);
}

const CREW_PITCH = { ghost: 880, wire: 660, brick: 440 };

export const sfx = {
  click() { tone(1400, 0.04, { type: "square", vol: 0.04 }); },
  hover() { tone(2200, 0.02, { type: "sine", vol: 0.02 }); },
  select(role) { tone(CREW_PITCH[role] || 600, 0.09, { type: "triangle", vol: 0.12 }); tone((CREW_PITCH[role] || 600) * 1.5, 0.08, { type: "triangle", vol: 0.08, at: 0.05 }); },
  place(role) { tone((CREW_PITCH[role] || 600) * 1.2, 0.06, { type: "triangle", vol: 0.1, slide: (CREW_PITCH[role] || 600) * 1.5 }); },
  remove() { tone(500, 0.08, { type: "triangle", vol: 0.1, slide: 300 }); },
  wait() { tone(320, 0.05, { type: "square", vol: 0.05 }); },
  error() { tone(180, 0.16, { type: "sawtooth", vol: 0.08 }); tone(150, 0.16, { type: "sawtooth", vol: 0.06, at: 0.08 }); },
  hack() { for (let k = 0; k < 6; k++) tone(900 + Math.random() * 1400, 0.04, { type: "square", vol: 0.04, at: k * 0.05 }); },
  hackDone() { tone(1046, 0.08, { type: "square", vol: 0.06 }); tone(1568, 0.14, { type: "square", vol: 0.06, at: 0.08 }); },
  grab() { tone(1318, 0.08, { type: "triangle", vol: 0.12 }); tone(1975, 0.18, { type: "triangle", vol: 0.1, at: 0.07 }); },
  takedown() { noise(0.18, { vol: 0.5, freq: 200, q: 0.7, type: "lowpass" }); tone(90, 0.2, { type: "sine", vol: 0.3, slide: 50 }); },
  door() { noise(0.35, { vol: 0.12, freq: 600, q: 0.5 }); tone(220, 0.3, { type: "sine", vol: 0.06, slide: 330 }); },
  escape() { tone(660, 0.1, { type: "triangle", vol: 0.08 }); tone(990, 0.12, { type: "triangle", vol: 0.08, at: 0.08 }); },
  step() { noise(0.03, { vol: 0.03, freq: 2500, q: 2 }); },
  spot() { tone(1200, 0.06, { type: "square", vol: 0.05 }); },
  go() { tone(523, 0.1, { type: "triangle", vol: 0.12 }); tone(784, 0.16, { type: "triangle", vol: 0.12, at: 0.1 }); },
  success() {
    [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.22, { type: "triangle", vol: 0.13, at: k * 0.09 }));
    tone(1318, 0.5, { type: "sine", vol: 0.1, at: 0.4 });
  },
  fail() { [392, 330, 262, 196].forEach((f, k) => tone(f, 0.24, { type: "sawtooth", vol: 0.07, at: k * 0.13 })); },
  star(k) { tone(880 * Math.pow(1.26, k), 0.18, { type: "triangle", vol: 0.12 }); },
};

export function startSiren() {
  const c = ac();
  if (!c || muted || siren) return;
  const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
  o.type = "sawtooth"; o.frequency.value = 700;
  lfo.frequency.value = 1.6; lg.gain.value = 260;
  lfo.connect(lg).connect(o.frequency);
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 0.1);
  const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800;
  o.connect(f).connect(g).connect(master);
  o.start(); lfo.start();
  siren = { o, lfo, g };
}

export function stopSiren() {
  if (!siren || !ctx) return;
  const { o, lfo, g } = siren;
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
  o.stop(ctx.currentTime + 0.35); lfo.stop(ctx.currentTime + 0.35);
  siren = null;
}

export function unlock() { ac(); }
