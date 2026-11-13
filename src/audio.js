// Sound: a low drone that never stops, air in the open voids, and the walker's footsteps.
// Everything is synthesised; there are no audio files.

export function makeAudio() {
  let ctx = null, master = null, air = null, noiseBuf = null, muted = false;
  const A = {};

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  A.start = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) { seed = (seed * 1664525 + 1013904223) | 0; data[i] = (seed >>> 8) / 8388608 - 1; }

    // Drone: three low tones, each breathing slowly.
    for (const [freq, level, rate] of [[41.2, 0.22, 0.07], [61.9, 0.11, 0.045], [82.9, 0.05, 0.11]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      g.gain.value = level;
      lfo.frequency.value = rate; lg.gain.value = level * 0.6;
      lfo.connect(lg); lg.connect(g.gain);
      osc.connect(g); g.connect(master);
      osc.start(); lfo.start();
    }
    // Rumble.
    const rumble = noiseSource(), rf = ctx.createBiquadFilter(), rg = ctx.createGain();
    rf.type = 'lowpass'; rf.frequency.value = 130; rg.gain.value = 0.5;
    rumble.connect(rf); rf.connect(rg); rg.connect(master); rumble.start();
    // Air: louder in open voids.
    const wind = noiseSource(), wf = ctx.createBiquadFilter();
    air = ctx.createGain();
    wf.type = 'bandpass'; wf.frequency.value = 520; wf.Q.value = 0.6; air.gain.value = 0.02;
    wind.connect(wf); wf.connect(air); air.connect(master); wind.start();
  };

  function burst(freq, q, level, len) {
    const t = ctx.currentTime, src = noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 1.5); src.stop(t + len + 0.02);
  }
  function thump(from, to, level, len) {
    const t = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + len);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + len + 0.02);
  }

  A.step = (running) => {
    if (!ctx || muted) return;
    burst(650 + Math.random() * 500, 4, running ? 0.3 : 0.2, 0.11);
    thump(95, 48, running ? 0.22 : 0.14, 0.09);
  };
  A.land = () => {
    if (!ctx || muted) return;
    burst(420, 2, 0.5, 0.3);
    thump(80, 30, 0.6, 0.35);
  };
  A.setOpen = (v) => { if (ctx && air) air.gain.setTargetAtTime(0.015 + 0.07 * v, ctx.currentTime, 1.5); };
  A.setMuted = (m) => { muted = m; if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05); };
  A.isMuted = () => muted;
  return A;
}
