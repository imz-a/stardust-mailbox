/* ============================================================
 * art.js —— 美术资源注册表
 * ------------------------------------------------------------
 * 画面资源分两类：
 *   1. PHOTO  真实画稿（AI 生成 / 画师绘制），放在 assets/ 下
 *   2. SVG    程序化生成的抽象画面（星海）与兜底渐变
 * 想把某个场景换成真画：在 PHOTO.bg 里加一行即可。
 * 想给角色加表情：把图丢进 assets/ch/，在 PHOTO.char 登记文件名。
 * ============================================================ */
const ART = (function () {

  const A = 'assets/';

  /* ============================ 真实画稿 ============================ */
  const PHOTO = {
    /* 场景背景：key 与 story.js 里 { bg: '...' } 对应 */
    bg: {
      corridor_dusk:   A + 'bg/corridor_dusk.png',
      observatory:     A + 'bg/observatory.png',
      starfield:       A + 'bg/starfield.png',
      classroom_rain:  A + 'bg/classroom_rain.png',
      rooftop_night:   A + 'bg/rooftop_night.png',
      gate_morning:    A + 'bg/gate_morning.png',
      /* 第二幕新增 */
      archive_room:      A + 'bg/archive_room.png',
      observatory_night: A + 'bg/observatory_night.png',
      rooftop_dawn:      A + 'bg/rooftop_dawn.png',
      mailbox_corner:    A + 'bg/mailbox_corner.png',
      library_dusk:      A + 'bg/library_dusk.png',
      lawn_summer:       A + 'bg/lawn_summer.png'
    },
    /* 角色立绘：透明背景 PNG */
    char: {
      chenyu: {
        normal:   A + 'ch/chenyu_normal.png',
        surprise: A + 'ch/chenyu_surprise.png',
        sad:      A + 'ch/chenyu_sad.png',
        smile:    A + 'ch/chenyu_smile.png',
        angry:    A + 'ch/chenyu_angry.png'
      },
      hoshi: {
        normal:   A + 'ch/hoshi_normal.png',
        surprise: A + 'ch/hoshi_surprise.png',
        sad:      A + 'ch/hoshi_sad.png',
        smile:    A + 'ch/hoshi_smile.png',
        cry:      A + 'ch/hoshi_cry.png'
      },
      suhe: {
        normal:   A + 'ch/suhe_normal.png',
        smile:    A + 'ch/suhe_smile.png',
        sad:      A + 'ch/suhe_sad.png'
      }
    }
  };

  /* ============================ 程序化画面 ============================ */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function starField(n, w, h, seed, maxR, color) {
    const r = rng(seed), c = color || '#ffffff';
    let o = '';
    for (let i = 0; i < n; i++) {
      o += '<circle cx="' + (r() * w).toFixed(1) + '" cy="' + (r() * h).toFixed(1) +
           '" r="' + (0.5 + r() * maxR).toFixed(2) + '" fill="' + c +
           '" opacity="' + (0.2 + r() * 0.8).toFixed(2) + '"/>';
    }
    return o;
  }

  const SV = 'viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"';

  const BG = {
    /* 抽象星海：结局与标题使用，不依赖画稿也成立 */
    starfield:
      '<svg ' + SV + '>' +
        '<defs>' +
          '<linearGradient id="sfSky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#050610"/><stop offset="0.55" stop-color="#131a3c"/>' +
            '<stop offset="1" stop-color="#3b2c58"/></linearGradient>' +
          '<radialGradient id="sfN1" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#7a5cc4" stop-opacity="0.42"/>' +
            '<stop offset="1" stop-color="#7a5cc4" stop-opacity="0"/></radialGradient>' +
          '<radialGradient id="sfN2" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#3f8fb8" stop-opacity="0.34"/>' +
            '<stop offset="1" stop-color="#3f8fb8" stop-opacity="0"/></radialGradient>' +
        '</defs>' +
        '<rect width="1600" height="900" fill="url(#sfSky)"/>' +
        '<ellipse cx="420" cy="330" rx="540" ry="310" fill="url(#sfN1)"/>' +
        '<ellipse cx="1190" cy="410" rx="500" ry="270" fill="url(#sfN2)"/>' +
        starField(460, 1600, 800, 31, 2.0) +
        '<path d="M0,900 L0,706 C250,668 430,706 650,696 C910,684 1190,656 1600,696 L1600,900 Z" fill="#0a0917"/>' +
        '<g fill="#04030a">' +
          '<path d="M694,696 L704,608 A88,88 0 0 1 876,608 L886,696 Z"/>' +
          '<rect x="772" y="566" width="26" height="56"/>' +
        '</g>' +
      '</svg>',

    black: '<svg ' + SV + '><rect width="1600" height="900" fill="#06070f"/></svg>',
    white: '<svg ' + SV + '><rect width="1600" height="900" fill="#f6f2ea"/></svg>'
  };

  /* 占位背景：尚无真画的场景用统一调性兜底，避免画面突然崩掉 */
  function placeholder(name) {
    const seed = name.split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0);
    return '<svg ' + SV + '>' +
      '<defs><linearGradient id="ph' + seed + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#241f38"/><stop offset="0.62" stop-color="#6b4a4e"/>' +
        '<stop offset="1" stop-color="#c98a4e"/></linearGradient></defs>' +
      '<rect width="1600" height="900" fill="url(#ph' + seed + ')"/>' +
      starField(60, 1600, 620, seed, 1.4) +
      '<text x="800" y="466" text-anchor="middle" font-family="sans-serif" font-size="32" ' +
        'fill="rgba(255,255,255,.45)" letter-spacing="8">' + name + '</text>' +
      '</svg>';
  }

  /* ============================ 对外接口 ============================ */

  function bgSource(name) {
    if (PHOTO.bg[name]) return { type: 'img', src: PHOTO.bg[name] };
    if (BG[name]) return { type: 'svg', svg: BG[name] };
    return { type: 'svg', svg: placeholder(name) };
  }

  /* 生成背景 DOM 节点（img 或 svg 容器） */
  function bgNode(name) {
    const s = bgSource(name);
    if (s.type === 'img') {
      const img = document.createElement('img');
      img.src = s.src; img.alt = ''; img.decoding = 'async';
      img.className = 'bg-img';
      return img;
    }
    const d = document.createElement('div');
    d.className = 'svg-hold';
    d.innerHTML = s.svg;
    return d;
  }

  function charSource(id, pose) {
    const set = PHOTO.char[id];
    if (!set) return null;
    return set[pose] || set.normal || null;
  }

  /* 生成立绘 DOM 节点；没有画稿返回 null，引擎会退回剪影 */
  function charNode(id, pose) {
    const src = charSource(id, pose);
    if (!src) return null;
    const img = document.createElement('img');
    img.src = src; img.alt = CHAR_NAME[id] || ''; img.decoding = 'async';
    img.dataset.pose = pose;
    return img;
  }

  /* 画稿里脸部的外接框（归一化坐标），用于自动裁切成半身立绘 */
  const FACE = {
    'assets/ch/chenyu_normal.png':   { left: 0.187, right: 0.813, top: 0.030, bottom: 0.412 },
    'assets/ch/chenyu_surprise.png': { left: 0.187, right: 0.813, top: 0.030, bottom: 0.412 },
    'assets/ch/chenyu_sad.png':      { left: 0.187, right: 0.813, top: 0.030, bottom: 0.412 },
    /* smile / angry 与原表情同一构图，复用同一套脸部框，避免切换时人物大小跳变 */
    'assets/ch/chenyu_smile.png':    { left: 0.187, right: 0.813, top: 0.030, bottom: 0.412 },
    'assets/ch/chenyu_angry.png':    { left: 0.187, right: 0.813, top: 0.030, bottom: 0.412 },
    'assets/ch/hoshi_normal.png':    { left: 0.103, right: 0.881, top: 0.059, bottom: 0.359 },
    'assets/ch/hoshi_sad.png':       { left: 0.103, right: 0.855, top: 0.059, bottom: 0.359 },
    'assets/ch/hoshi_surprise.png':  { left: 0.103, right: 0.877, top: 0.059, bottom: 0.359 },
    'assets/ch/hoshi_smile.png':     { left: 0.322, right: 0.705, top: 0.068, bottom: 0.368 },
    'assets/ch/suhe_normal.png':     { left: 0.153, right: 0.853, top: 0.043, bottom: 0.343 },
    'assets/ch/suhe_smile.png':      { left: 0.175, right: 0.807, top: 0.000, bottom: 0.299 },
    /* 同一构图，复用 suhe_normal 的框 */
    'assets/ch/suhe_sad.png':        { left: 0.153, right: 0.853, top: 0.043, bottom: 0.343 },
    /* 同一构图，复用 hoshi_normal 的框 */
    'assets/ch/hoshi_cry.png':       { left: 0.103, right: 0.881, top: 0.059, bottom: 0.359 }
  };

  const CHAR_NAME = { chenyu: '陈屿', suhe: '苏禾', hoshi: '？？？' };

  return {
    PHOTO: PHOTO, BG: BG, FACE: FACE, CHAR_NAME: CHAR_NAME,
    bgNode: bgNode, charNode: charNode, charSource: charSource, bgSource: bgSource
  };
})();
