/* ============================================================
 * audio.js —— 用 WebAudio 实时合成 BGM 与音效
 * 好处：零音频文件，改几个音符就能换曲子
 * ============================================================ */
const Audio2 = (function () {

  let ctx = null, busBgm = null, busSe = null, conv = null;
  let timer = null, step = 0, track = null, curName = '';
  const vol = { bgm: 0.45, se: 0.6 };

  const mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  /* 各曲目：音符序列（null 表示休止）、步进毫秒、波形、和弦垫 */
  const TRACKS = {
    dusk:    { notes: [60, 64, 67, 71, 67, 64, 62, 59], step: 520, wave: 'triangle', pad: [48, 55, 64], padEvery: 8, gain: 0.16 },
    night:   { notes: [72, null, 67, null, 74, null, 71, null], step: 620, wave: 'sine', pad: [43, 50, 59], padEvery: 8, gain: 0.15 },
    warm:    { notes: [65, 69, 72, 76, 72, 69, 67, 64], step: 480, wave: 'triangle', pad: [41, 48, 57], padEvery: 8, gain: 0.16 },
    mystic:  { notes: [69, 73, 76, 81, 76, 73, 74, 69], step: 430, wave: 'sine', pad: [45, 52, 61], padEvery: 8, gain: 0.14 },
    tense:   { notes: [57, 60, 64, 63, 60, 57, 55, 58], step: 400, wave: 'triangle', pad: [45, 52, 60], padEvery: 8, gain: 0.15 },
    morning: { notes: [67, 71, 74, 79, 74, 71, 69, 67], step: 420, wave: 'triangle', pad: [43, 50, 59], padEvery: 8, gain: 0.16 },
    ending:  { notes: [60, 64, 67, 72, 76, 72, 67, 64], step: 580, wave: 'sine', pad: [41, 48, 57], padEvery: 8, gain: 0.17 },
    title:   { notes: [64, 67, 71, 67, 69, 72, 69, 67], step: 560, wave: 'sine', pad: [40, 47, 55], padEvery: 8, gain: 0.15 }
  };

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    busBgm = ctx.createGain(); busBgm.gain.value = vol.bgm;
    busSe = ctx.createGain(); busSe.gain.value = vol.se;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    busBgm.connect(lp); lp.connect(ctx.destination);
    busSe.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function note(freq, when, dur, wave, gain, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(dest || busBgm);
    o.start(when); o.stop(when + dur + 0.05);
  }

  function padChord(midis, when, dur, gain) {
    midis.forEach(function (m) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = mtof(m);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(gain, when + dur * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(busBgm);
      o.start(when); o.stop(when + dur + 0.1);
    });
  }

  function playBgm(name) {
    if (!init()) return;
    resume();
    if (curName === name) return;
    stopBgm();
    curName = name || '';
    if (!name || !TRACKS[name]) return;
    track = TRACKS[name];
    step = 0;
    timer = setInterval(function () {
      if (!track) return;
      if (ctx.state !== 'running') return;   // 等待用户手势解锁，避免一次性爆音
      const t = ctx.currentTime + 0.02;
      const n = track.notes[step % track.notes.length];
      if (n !== null) {
        note(mtof(n), t, track.step / 1000 * 1.9, track.wave, track.gain);
        if (step % 4 === 0) note(mtof(n + 12), t + 0.02, track.step / 1000 * 1.2, 'sine', track.gain * 0.35);
      }
      if (step % track.padEvery === 0) {
        padChord(track.pad, t, track.step / 1000 * track.padEvery * 1.05, track.gain * 0.55);
      }
      step++;
    }, track.step);
  }

  function stopBgm() {
    if (timer) { clearInterval(timer); timer = null; }
    track = null; curName = '';
  }

  /* ---------------- 音效 ---------------- */
  function noiseBuffer(dur) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }

  function se(name) {
    if (!init()) return;
    resume();
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'click':
        note(1100, t, 0.05, 'sine', 0.10, busSe);
        break;
      case 'chime':
        note(1568, t, 0.55, 'sine', 0.16, busSe);
        note(2093, t + 0.06, 0.7, 'sine', 0.11, busSe);
        note(2637, t + 0.13, 0.9, 'sine', 0.06, busSe);
        break;
      case 'paper': {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(0.35);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.9;
        const g = ctx.createGain(); g.gain.value = 0.20;
        src.connect(bp); bp.connect(g); g.connect(busSe);
        src.start(t);
        break;
      }
      case 'mailbox':
        note(150, t, 0.32, 'sine', 0.28, busSe);
        note(880, t + 0.02, 0.18, 'triangle', 0.10, busSe);
        note(1320, t + 0.04, 0.22, 'sine', 0.06, busSe);
        break;
      case 'heartbeat':
        note(58, t, 0.22, 'sine', 0.34, busSe);
        note(52, t + 0.30, 0.30, 'sine', 0.28, busSe);
        break;
      case 'select':
        note(880, t, 0.10, 'triangle', 0.13, busSe);
        note(1320, t + 0.05, 0.14, 'triangle', 0.09, busSe);
        break;
    }
  }

  function setVolume(kind, v) {
    vol[kind] = v;
    if (kind === 'bgm' && busBgm) busBgm.gain.value = v;
    if (kind === 'se' && busSe) busSe.gain.value = v;
  }

  return { init: init, resume: resume, playBgm: playBgm, stopBgm: stopBgm, se: se, setVolume: setVolume, vol: vol };
})();
