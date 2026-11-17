// Tiny synthesized sound effects (Web Audio, no audio files).
window.Sfx = (() => {
  let ctx = null;
  let enabled = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, at, dur, { type = 'sine', gain = 0.18, to = null } = {}) {
    const c = ctx;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(at, dur, gain = 0.12) {
    const c = ctx;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start(c.currentTime + at);
  }

  const sounds = {
    reveal() {
      tone(660, 0, 0.18, { type: 'triangle', gain: 0.22 });
      tone(990, 0.09, 0.35, { type: 'triangle', gain: 0.2 });
      tone(1320, 0.16, 0.5, { type: 'sine', gain: 0.08 });
    },
    shown() {
      tone(520, 0, 0.18, { type: 'sine', gain: 0.1 });
    },
    strike() {
      tone(180, 0, 0.55, { type: 'sawtooth', gain: 0.16, to: 70 });
      tone(120, 0, 0.6, { type: 'square', gain: 0.08, to: 55 });
      noise(0, 0.3, 0.1);
    },
    steal() {
      [392, 370, 392, 523].forEach((f, i) => tone(f, 0.5 + i * 0.12, 0.2, { type: 'square', gain: 0.06 }));
    },
    award() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, { type: 'triangle', gain: 0.18 }));
      tone(1568, 0.4, 0.6, { type: 'sine', gain: 0.07 });
    },
    whoosh() {
      noise(0, 0.25, 0.06);
      tone(300, 0, 0.25, { type: 'sine', gain: 0.05, to: 700 });
    },
    final() {
      const notes = [523, 523, 659, 784, 659, 784, 1047];
      notes.forEach((f, i) => tone(f, i * 0.14, i === notes.length - 1 ? 1.1 : 0.2, { type: 'triangle', gain: 0.18 }));
      tone(262, 0.84, 1.1, { type: 'sine', gain: 0.12 });
    },
    intro() {
      // Snare roll that speeds up, then a big rising chord.
      let t = 0;
      for (let i = 0; i < 18; i++) {
        noise(t, 0.08, 0.05 + i * 0.006);
        t += Math.max(0.035, 0.11 - i * 0.005);
      }
      [262, 330, 392, 523, 659].forEach((f, i) => tone(f, t + i * 0.07, 1.2 - i * 0.1, { type: 'sawtooth', gain: 0.05 }));
      [523, 784, 1047].forEach((f, i) => tone(f, t + 0.35 + i * 0.12, 0.9, { type: 'triangle', gain: 0.14 }));
    },
    tick() {
      tone(1200, 0, 0.05, { type: 'square', gain: 0.03 });
    },
  };

  return {
    get enabled() { return enabled && !!ctx && ctx.state === 'running'; },
    enable() { enabled = true; return !!ensure(); },
    disable() { enabled = false; },
    play(name) {
      if (!enabled || !ctx || ctx.state !== 'running' || !sounds[name]) return;
      try { sounds[name](); } catch (_) { /* never break the show over a beep */ }
    },
  };
})();
