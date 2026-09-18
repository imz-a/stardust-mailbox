/* ============================================================
 * engine.js —— 视觉小说引擎核心
 * 负责：脚本解析、立绘/背景调度、打字机、选项、存档、历史、设置
 * ============================================================ */
const VN = (function () {

  const $ = function (s) { return document.querySelector(s); };
  const KEY = {
    cfg: 'vn_config', seen: 'vn_seen', endings: 'vn_endings', auto: 'vn_auto',
    slot: function (n) { return 'vn_slot_' + n; }, last: 'vn_last_slot', quick: 'vn_quick',
    recap: function (k) { return 'vn_recap_' + k; }
  };

  /* ---------------- 配置 ---------------- */
  const CONFIG = Object.assign({
    textSpeed: 32,      // 每个字毫秒
    autoDelay: 1200,    // 自动播放停顿
    bgm: 45, se: 60,
    skipUnread: false,
    textScale: 100,     // 文字大小（百分比）
    reduceMotion: false // 手动减弱动效
  }, load(KEY.cfg) || {});
  function saveCfg() { save(KEY.cfg, CONFIG); }
  function applyConfig() {
    document.documentElement.style.setProperty('--text-scale', (CONFIG.textScale / 100).toFixed(3));
    document.body.classList.toggle('reduce-motion', !!CONFIG.reduceMotion);
  }

  /* localStorage 写失败必须让上层知道：配额满时 setItem 会抛 QuotaExceededError，
     以前这里直接吞掉，导致「点了保存但什么都没存」且玩家毫无察觉。 */
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  /* ---------------- 运行时状态 ---------------- */
  const S = {
    label: '', index: 0, vars: {},
    bg: null, bgm: null, weather: null,
    chars: {},           // id -> {pose, at}
    history: [], seen: load(KEY.seen) || {},
    typing: false, typer: null, auto: false, skip: false,
    waiting: false, ended: null, started: false,
    autoTimer: null, skipTimer: null
  };

  let nameToId = {};
  Object.keys(ART.CHAR_NAME).forEach(function (id) { nameToId[ART.CHAR_NAME[id]] = id; });

  /* ============================================================
   * 资源渲染
   * ============================================================ */
  let bgFront = null;

  function setBg(name) {
    if (S.bg === name) return;
    S.bg = name;
    const layerA = $('#bg-a'), layerB = $('#bg-b');
    const front = bgFront === layerA ? layerB : layerA;
    const back = bgFront === layerA ? layerA : layerB;
    front.replaceChildren(ART.bgNode(name));
    front.style.zIndex = 2;
    back.style.zIndex = 1;
    front.classList.add('show');
    back.classList.remove('show');
    bgFront = front;
  }

  /* ------------------------------------------------------------
   * 立绘按「脸部尺寸」自动缩放：
   * 人脸高度统一占舞台高度的 FACE_H，再按锚点水平对齐、底边贴舞台底。
   * 想调整人物大小只改 FACE_H；水平位置由 at-left/center/right 决定。
   * ------------------------------------------------------------ */
  /* 脸高占舞台高度的比例（越大人物越大）。
     与 art.js 的 FACE 框配套：框高统一 0.20（= 发顶到下巴），
     所以立绘显示高度 = 舞台高 × FACE_H / 0.20 ≈ 0.68 舞台高。 */
  const FACE_H = 0.135;

  function buildChar(id, pose, side) {
    const wrap = document.createElement('div');
    const src = ART.charSource(id, pose);

    if (!src) {
      /* 尚无画稿：用剪影占位，保持构图不崩 */
      wrap.className = 'char-slot missing at-' + side;
      wrap.dataset.id = id;
      const sil = document.createElement('div');
      sil.className = 'silhouette';
      sil.style.width = 'clamp(200px, 22vh, 300px)';
      sil.style.height = '62vh';
      sil.style.left = (side === 'left' ? '26%' : side === 'right' ? '74%' : '50%');
      wrap.appendChild(sil);
      return wrap;
    }

    const f = ART.FACE[src] || { left: 0.2, right: 0.8, top: 0.03, bottom: 0.4 };
    const faceW = f.right - f.left;
    const faceH = f.bottom - f.top;

    /* 水平锚点：left=0.26 / center=0.5 / right=0.74（舞台宽度比例） */
    const anchorX = side === 'left' ? 0.26 : side === 'right' ? 0.74 : 0.5;

    const win = function (W, H) {
      /* 让「脸部高度」占舞台高度的 FACE_H，水平按锚点对齐，底边贴舞台底。
         关键：缩放系数必须作用在图片的「原始像素尺寸」上（不能直接乘舞台高度），
         且立绘以底边贴地的方式摆放 —— 这样半身像自然站在画面下缘，不会悬空。 */
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
      const k = (H * FACE_H) / (nh * faceH);   // 相对原始图片的缩放比例
      const iw = nw * k, ih = nh * k;
      const fc = { x: (f.left + faceW / 2) * iw };   // 脸心在图片内的横向位置
      /* 立绘以 scaleX(-1) 翻转朝内，而 transform-origin 是图片左上角，
         于是图片实际渲染在 [left - iw, left] 这一段里，脸心落在 left - fc.x。
         要把它摆到锚点上必须写成 + fc.x —— 写成 - fc.x 会让整张图左移 2*fc.x，
         人物被挤出画面（这是「立绘不在应该在的位置」的元凶）。 */
      const left = W * anchorX + fc.x;                // 翻转后脸心对齐水平锚点
      const top = H - ih;                             // 底边贴舞台底
      return { k: k, w: iw, h: ih, l: left, t: top };
    };

    wrap.className = 'char-slot at-' + side;
    wrap.dataset.id = id;

    const img = document.createElement('img');
    img.alt = ART.CHAR_NAME[id] || '';
    img.decoding = 'async';
    img.src = src;
    img.style.transform = 'scaleX(-1)';    // 朝内
    wrap.appendChild(img);

    const place = function () {
      const sw = wrap.clientWidth, sh = wrap.clientHeight;
      if (!sw || !sh || !img.naturalWidth) return;
      const m = win(sw, sh);
      img.style.width = m.w + 'px';
      img.style.height = m.h + 'px';
      img.style.left = m.l + 'px';
      img.style.top = m.t + 'px';
    };

    if (img.complete) place();
    else img.addEventListener('load', place);
    if (window.ResizeObserver) new ResizeObserver(place).observe(wrap);
    else window.addEventListener('resize', place);

    /* 注意：这里曾经把立绘的镜像 PNG 以 dataURL 存进 localStorage「备用」，
       但全项目没有任何地方读取它。一张 1024x1428 立绘的 dataURL 约 1.7MB，
       存满 3 张就把 5MB 的 localStorage 配额吃干净了 —— 后果是之后所有
       存档/读档/自动存档的 setItem 全部静默抛 QuotaExceededError 并被吞掉，
       玩家表现为「存档没反应」。镜像直接用 CSS 的 scaleX(-1) 实现即可，不需要副本。 */
    return wrap;
  }

  function setWeather(kind) {
    S.weather = kind;
    const w = $('#weather');
    w.innerHTML = '';
    w.className = 'weather ' + (kind || '');
    if (!kind) return;
    const n = kind === 'rain' ? 70 : kind === 'sakura' ? 26 : 46;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      const r = Math.random();
      if (kind === 'rain') {
        d.style.left = (r * 100).toFixed(2) + '%';
        d.style.animationDuration = (0.5 + Math.random() * 0.5).toFixed(2) + 's';
        d.style.animationDelay = (-Math.random() * 2).toFixed(2) + 's';
        d.style.height = (18 + Math.random() * 26).toFixed(0) + 'px';
        d.style.opacity = (0.2 + Math.random() * 0.45).toFixed(2);
      } else if (kind === 'sakura') {
        d.style.left = (r * 100).toFixed(2) + '%';
        d.style.animationDuration = (6 + Math.random() * 6).toFixed(2) + 's';
        d.style.animationDelay = (-Math.random() * 10).toFixed(2) + 's';
        d.style.transform = 'scale(' + (0.6 + Math.random() * 0.9).toFixed(2) + ')';
      } else {
        d.style.left = (r * 100).toFixed(2) + '%';
        d.style.top = (Math.random() * 70).toFixed(2) + '%';
        d.style.animationDuration = (2 + Math.random() * 3).toFixed(2) + 's';
        d.style.animationDelay = (-Math.random() * 4).toFixed(2) + 's';
      }
      w.appendChild(d);
    }
  }

  function renderChars() {
    const layer = $('#char-layer');
    Object.keys(S.chars).forEach(function (id) {
      const c = S.chars[id];
      let el = layer.querySelector('.char[data-id="' + id + '"]');
      const isNew = !el;
      if (isNew) {
        el = document.createElement('div');
        el.className = 'char';
        el.dataset.id = id;
        layer.appendChild(el);
      }
      const slot = el.firstChild;
      const wantAt = 'at-' + (c.at || 'center');
      const curPose = slot && slot.querySelector('img') ? slot.querySelector('img').dataset.pose : null;
      if (!slot || slot.className.indexOf(wantAt) === -1 || curPose !== c.pose) {
        el.replaceChildren(buildChar(id, c.pose, c.at || 'center'));
      }
      if (isNew) requestAnimationFrame(function () { el.classList.add('in'); });
    });
    Array.prototype.slice.call(layer.children).forEach(function (el) {
      if (!S.chars[el.dataset.id]) {
        el.classList.remove('in');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 420);
      }
    });
  }

  function showChar(id, pose, at) {
    const prev = S.chars[id];
    if (prev && prev.at === (at || 'center') && prev.pose === (pose || 'normal')) return;
    /* 同屏上限 3 人（左 / 中 / 右），这是 VN 演出的通行做法。
       超过 3 人时挤掉最早登场的那位，避免立绘堆叠糊成一片。 */
    if (!prev && Object.keys(S.chars).length >= 3) {
      const oldest = Object.keys(S.chars)[0];
      delete S.chars[oldest];
    }
    S.chars[id] = { pose: pose || 'normal', at: at || 'center' };
    renderChars();
  }

  function hideChar(id) {
    if (!S.chars[id]) return;
    delete S.chars[id];
    renderChars();
  }

  function highlightSpeaker(name) {
    const id = nameToId[name];
    Array.prototype.forEach.call(document.querySelectorAll('.char'), function (el) {
      el.classList.toggle('dim', !!id && el.dataset.id !== id);
      el.classList.toggle('speaking', !!id && el.dataset.id === id);
    });
  }

  function fx(kind) {
    if (kind === 'shake') {
      const st = $('.stage');
      st.classList.remove('shake');
      void st.offsetWidth;
      st.classList.add('shake');
      setTimeout(function () { st.classList.remove('shake'); }, 620);
    } else if (kind === 'flash') {
      const f = $('#fx-flash');
      f.classList.add('on');
      setTimeout(function () { f.classList.remove('on'); }, 420);
    }
  }

  function showCard(text) {
    return new Promise(function (res) {
      const c = $('#card');
      c.innerHTML = '<div class="card-text"></div>';
      c.querySelector('.card-text').textContent = text;
      c.classList.add('show');
      setTimeout(function () {
        c.classList.remove('show');
        setTimeout(res, 500);
      }, 1800);
    });
  }

  /* ============================================================
   * 脚本执行
   * ============================================================ */
  function nodeId() { return S.label + ':' + (S.index - 1); }

  function run() {
    if (S.ended) return;
    const scene = STORY.scenes[S.label];
    if (!scene) return;
    while (S.index < scene.length) {
      const ins = scene[S.index++];
      const stop = apply(ins);
      if (stop === 'wait') return;
      if (stop === 'promise') return;
    }
  }

  function apply(ins) {
    if (ins.bg !== undefined) setBg(ins.bg);
    if (ins.bgm !== undefined) {
      S.bgm = ins.bgm;
      if (ins.bgm) Audio2.playBgm(ins.bgm); else Audio2.stopBgm();
    }
    if (ins.se) Audio2.se(ins.se);
    if (ins.weather !== undefined) setWeather(ins.weather);
    if (ins.fx) fx(ins.fx);
    if (ins.show) showChar(ins.show, ins.pose, ins.at);
    if (ins.hide) hideChar(ins.hide);
    if (ins.clear) { S.chars = {}; renderChars(); }
    if (ins.set) Object.assign(S.vars, ins.set);

    if (ins.card) {
      showCard(ins.card).then(function () { run(); });
      return 'promise';
    }

    if (ins.jump || ins.goto) {
      S.label = ins.jump || ins.goto; S.index = 0;
      return;
    }

    if (ins.branch) {
      for (let i = 0; i < ins.branch.length; i++) {
        const b = ins.branch[i];
        if (Array.isArray(b)) {
          try { if (b[0](S.vars)) { S.label = b[1]; S.index = 0; return; } } catch (e) {}
        } else { S.label = b; S.index = 0; return; }
      }
    }

    if (ins.choice) { presentChoice(ins.choice); return 'wait'; }

    if (ins.end) { doEnding(ins.end); return 'wait'; }

    if (ins.say !== undefined) {
      if (ins.pose && nameToId[ins.say]) showChar(nameToId[ins.say], ins.pose, S.chars[nameToId[ins.say]] ? S.chars[nameToId[ins.say]].at : 'center');
      present(ins.say, ins.text, ins.style);
      return 'wait';
    }

    if (ins.t !== undefined) { present(null, ins.t, ins.style); return 'wait'; }
    return;
  }

  /* ---------------- 显示一行 ---------------- */
  function present(name, text, style) {
    S.waiting = true;
    S.seen[nodeId()] = 1;
    S.history.push({ name: name, text: text });
    if (S.history.length > 300) S.history.shift();

    if (name && S.chars[nameToId[name]] && S.chars[nameToId[name]].pose !== 'surprise') {
      // 说话时轻微动作
    }
    $('#name-box').textContent = name || '';
    $('#name-box').classList.toggle('hidden', !name);
    highlightSpeaker(name);
    const box = $('#text-box');
    box.className = 'text-box' + (style ? ' st-' + style : '');
    $('#next-hint').classList.remove('show');

    if (S.skip) { skipStep(); return; }

    typewrite(box, text, function () {
      $('#next-hint').classList.add('show');
      if (S.auto) {
        clearTimeout(S.autoTimer);
        S.autoTimer = setTimeout(function () { if (S.auto) advance(); }, CONFIG.autoDelay + text.length * 18);
      }
    });
  }

  function typewrite(el, text, done) {
    clearInterval(S.typer);
    S.typing = true;
    el.textContent = '';
    let i = 0;
    const sp = Math.max(4, CONFIG.textSpeed);
    S.typer = setInterval(function () {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(S.typer); S.typing = false;
        done && done();
      }
    }, sp);
  }

  function finishTyping() {
    if (!S.typing) return false;
    clearInterval(S.typer); S.typing = false;
    const last = S.history[S.history.length - 1];
    $('#text-box').textContent = last ? last.text : '';
    $('#next-hint').classList.add('show');
    if (S.auto) {
      clearTimeout(S.autoTimer);
      S.autoTimer = setTimeout(function () { if (S.auto) advance(); }, CONFIG.autoDelay);
    }
    return true;
  }

  /* ---------------- 选项 ---------------- */
  function presentChoice(choice) {
    S.waiting = true;
    highlightSpeaker(null);
    $('#name-box').classList.add('hidden');
    $('#text-box').textContent = choice.q || '';
    $('#next-hint').classList.remove('show');
    const layer = $('#choice');
    layer.innerHTML = '';
    choice.options.forEach(function (opt, i) {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.textContent = opt.text;
      b.style.animationDelay = (i * 90) + 'ms';
      b.onclick = function (e) {
        e.stopPropagation();
        Audio2.se('select');
        if (opt.set) Object.assign(S.vars, opt.set);
        layer.innerHTML = '';
        layer.classList.remove('show');
        S.label = opt.goto; S.index = 0;
        saveAuto();
        run();
      };
      layer.appendChild(b);
    });
    layer.classList.add('show');
  }

  /* ---------------- 推进 ---------------- */
  function advance() {
    if (!S.started || S.ended) return;
    if (finishTyping()) return;
    clearTimeout(S.autoTimer);
    S.waiting = false;
    Audio2.se('click');
    saveAuto();
    run();
  }

  function skipStep() {
    const id = nodeId();
    const seen = !!S.seen[id];
    if (!seen && !CONFIG.skipUnread) { setSkip(false); run(); return; }
    clearTimeout(S.skipTimer);
    S.skipTimer = setTimeout(function () {
      if (!S.skip) return;
      S.waiting = false;
      saveAuto();
      run();
    }, 40);
  }

  function setSkip(v) {
    S.skip = v;
    $('#btn-skip').classList.toggle('on', v);
    if (v) { setAuto(false); advance(); }
  }
  function setAuto(v) {
    S.auto = v;
    $('#btn-auto').classList.toggle('on', v);
    if (!v) clearTimeout(S.autoTimer);
    else { finishTyping(); if (!S.typing) advance(); }
  }

  /* ---------------- 结局 ---------------- */
  function doEnding(key) {
    S.ended = key;
    Audio2.stopBgm();
    Audio2.playBgm('ending');
    const e = STORY.endings[key] || { name: '结局', tag: '', desc: '' };
    const unlocked = load(KEY.endings) || {};
    unlocked[key] = true;
    save(KEY.endings, unlocked);
    save(KEY.seen, S.seen);

    /* 记录这个结局的「回放快照」：结局场景的背景 / 天气 / 全部文本。
       结局画廊用它还原结局画面与文字，方便随时回顾。 */
    try {
      save(KEY.recap(key), {
        bg: S.bg || 'starfield',
        weather: S.weather || 'stars',
        lines: (STORY.scenes[S.label] || [])
          .filter(function (it) { return it.t || it.say; })
          .map(function (it) {
            return { name: it.say || '', text: it.t || it.text || '' };
          }),
        date: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' })
      });
    } catch (err) {}

    setBg('starfield');
    setWeather('stars');
    S.chars = {}; renderChars();
    $('#name-box').classList.add('hidden');
    $('#text-box').textContent = '';
    $('#next-hint').classList.remove('show');

    setTimeout(function () {
      const box = $('#ending-card');
      box.querySelector('.ec-tag').textContent = e.tag;
      box.querySelector('.ec-name').textContent = '「' + e.name + '」';
      box.querySelector('.ec-desc').textContent = e.desc;
      box.classList.add('show');
    }, 700);
  }

  /* ============================================================
   * 存档 / 读档
   * ============================================================ */
  function snapshot() {
    return {
      label: S.label, index: S.index, vars: S.vars,
      bg: S.bg, bgm: S.bgm, weather: S.weather, chars: S.chars,
      text: S.history.length ? S.history[S.history.length - 1].text : '',
      name: S.history.length ? S.history[S.history.length - 1].name : '',
      date: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    };
  }

  function saveAuto() { if (S.started && !S.ended) save(KEY.auto, snapshot()); }

  function doSave(n) {
    const ok = save(KEY.slot(n), snapshot());
    if (!ok) { Audio2.se('select'); toast('保存失败：浏览器存储空间已满'); return; }
    save(KEY.last, n);
    Audio2.se('select');
    renderSlots('#tmp-grid', true);
    toast('已保存到 槽位 ' + n);
  }

  function doLoad(n) {
    const d = load(KEY.slot(n));
    if (!d) { toast('这个槽位是空的'); return; }
    restore(d);
    closeOverlay();
  }

  function quickSave() {
    if (!S.started || S.ended) { toast('现在无法快速保存'); return; }
    const ok = save(KEY.quick, snapshot());
    Audio2.se('select');
    toast(ok ? '已快速保存（F9 读取）' : '快速保存失败：浏览器存储空间已满');
  }

  function quickLoad() {
    const d = load(KEY.quick);
    if (!d) { toast('还没有快速存档'); return; }
    restore(d);
    closeOverlay();
    toast('已读取快速存档');
  }

  function restore(d) {
    S.label = d.label; S.index = d.index;
    S.vars = d.vars || {}; S.chars = d.chars || {};
    S.ended = null; S.started = true;
    setBg(d.bg); setWeather(d.weather);
    renderChars();
    if (d.bgm) { S.bgm = d.bgm; Audio2.playBgm(d.bgm); }
    $('#ending-card').classList.remove('show');
    run();
  }

  function renderSlots(sel, isSave) {
    const grid = $(sel);
    grid.innerHTML = '';
    const lastN = load(KEY.last);
    const list = [];
    for (let i = 1; i <= 12; i++) list.push(i);
    list.forEach(function (n) {
      const d = load(KEY.slot(n));
      const isNew = d && lastN === n;
      const cell = document.createElement('div');
      cell.className = 'slot' + (d ? '' : ' empty') + (isNew ? ' newest' : '');
      const scene = d && d.label && STORY.scenes && STORY.scenes[d.label] && STORY.scenes[d.label].title;
      cell.innerHTML =
        '<div class="slot-thumb"></div>' +
        '<div class="slot-meta">' +
          '<div class="slot-no">槽位 ' + n + (isNew ? ' · 最新' : '') + '</div>' +
          (scene ? '<div class="slot-scene">' + scene + '</div>' : '') +
          '<div class="slot-text">' + (d ? (d.name ? '【' + d.name + '】' : '') + d.text : '—— 空 ——') + '</div>' +
          '<div class="slot-date">' + (d ? d.date : '') + '</div>' +
        '</div>';
      if (d && d.bg) cell.querySelector('.slot-thumb').appendChild(ART.bgNode(d.bg));
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.onclick = function () { Audio2.se('click'); if (isSave) doSave(n); else doLoad(n); };
      cell.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cell.onclick(); }
      };
      grid.appendChild(cell);
    });
  }

  /* ============================================================
   * 覆盖面板
   * ============================================================ */
  function openOverlay(kind) {
    const ov = $('#overlay');
    ov.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel';

    if (kind === 'save' || kind === 'load') {
      const isSave = kind === 'save';
      panel.innerHTML = '<h3>' + (isSave ? '保存进度' : '读取进度') + '</h3><div class="grid" id="tmp-grid"></div>';
      const close = document.createElement('button');
      close.className = 'btn'; close.textContent = '关闭';
      close.onclick = closeOverlay;
      panel.appendChild(close);
      ov.appendChild(panel);
      ov.classList.add('show');
      renderSlots('#tmp-grid', isSave);
      return;
    }

    if (kind === 'history') {
      panel.innerHTML = '<h3>文字回顾</h3><div class="history" id="hist"></div>';
      const h = panel.querySelector('#hist');
      S.history.slice().reverse().forEach(function (it) {
        const p = document.createElement('p');
        p.innerHTML = it.name ? '<b>' + it.name + '</b>：' + it.text : '<i>' + it.text + '</i>';
        h.appendChild(p);
      });
      const close = document.createElement('button');
      close.className = 'btn'; close.textContent = '关闭';
      close.onclick = closeOverlay;
      panel.appendChild(close);
      ov.appendChild(panel); ov.classList.add('show');
      return;
    }

    if (kind === 'config') {
      panel.innerHTML = '<h3>设置</h3>';
      const mk = function (label, key, min, max, fmt) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<span>' + label + '</span>';
        const r = document.createElement('input');
        r.type = 'range'; r.min = min; r.max = max; r.value = CONFIG[key];
        const out = document.createElement('em'); out.textContent = fmt(CONFIG[key]);
        r.oninput = function () {
          CONFIG[key] = +r.value; out.textContent = fmt(+r.value); saveCfg(); applyConfig();
          if (key === 'bgm') Audio2.setVolume('bgm', +r.value / 100);
          if (key === 'se') Audio2.setVolume('se', +r.value / 100);
        };
        row.appendChild(r); row.appendChild(out);
        panel.appendChild(row);
      };
      mk('文字速度', 'textSpeed', 4, 90, function (v) { return v < 20 ? '快' : v < 45 ? '中' : '慢'; });
      mk('自动播放间隔', 'autoDelay', 400, 3000, function (v) { return (v / 1000).toFixed(1) + ' 秒'; });
      mk('音乐音量', 'bgm', 0, 100, function (v) { return v + '%'; });
      mk('音效音量', 'se', 0, 100, function (v) { return v + '%'; });
      mk('文字大小', 'textScale', 80, 140, function (v) { return v + '%'; });

      const rowSkip = document.createElement('div');
      rowSkip.className = 'row';
      rowSkip.innerHTML = '<span>快进未读内容</span>';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = CONFIG.skipUnread;
      cb.onchange = function () { CONFIG.skipUnread = cb.checked; saveCfg(); };
      rowSkip.appendChild(cb);
      panel.appendChild(rowSkip);

      const rowRM = document.createElement('div');
      rowRM.className = 'row';
      rowRM.innerHTML = '<span>减弱动效</span>';
      const cbR = document.createElement('input');
      cbR.type = 'checkbox'; cbR.checked = CONFIG.reduceMotion;
      cbR.onchange = function () { CONFIG.reduceMotion = cbR.checked; saveCfg(); applyConfig(); };
      rowRM.appendChild(cbR);
      panel.appendChild(rowRM);

      const close = document.createElement('button');
      close.className = 'btn'; close.textContent = '关闭';
      close.onclick = closeOverlay;
      panel.appendChild(close);
      ov.appendChild(panel); ov.classList.add('show');
      return;
    }

    if (kind === 'menu') {
      panel.innerHTML = '<h3>菜单</h3>';
      ['返回游戏', '快速保存 (F5)', '快速读取 (F9)', '保存', '读取', '文字回顾', '设置', '回到标题'].forEach(function (t) {
        const b = document.createElement('button');
        b.className = 'btn wide'; b.textContent = t;
        b.onclick = function () {
          Audio2.se('click');
          if (t === '返回游戏') closeOverlay();
          else if (t === '快速保存 (F5)') quickSave();
          else if (t === '快速读取 (F9)') quickLoad();
          else if (t === '保存') openOverlay('save');
          else if (t === '读取') openOverlay('load');
          else if (t === '文字回顾') openOverlay('history');
          else if (t === '设置') openOverlay('config');
          else backToTitle();
        };
        panel.appendChild(b);
      });
      ov.appendChild(panel); ov.classList.add('show');
      return;
    }
  }

  function closeOverlay() {
    $('#overlay').classList.remove('show');
    $('#overlay').innerHTML = '';
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 1400);
  }

  /* ============================================================
   * 标题画面 / 画廊
   * ============================================================ */
  function backToTitle() {
    Audio2.stopBgm();
    Audio2.playBgm('title');
    S.started = false; S.ended = null;
    $('#screen-game').classList.remove('active');
    $('#screen-title').classList.add('active');
    $('#ending-card').classList.remove('show');
    closeOverlay();
    $('#btn-continue').classList.toggle('hidden', !load(KEY.auto));
  }

  function startNew() {
    Audio2.resume();
    S.label = STORY.start; S.index = 0;
    S.vars = {}; S.chars = {}; S.history = []; S.ended = null;
    S.bg = null; S.weather = null; S.started = true;
    $('#screen-title').classList.remove('active');
    $('#screen-game').classList.add('active');
    $('#ending-card').classList.remove('show');
    setAuto(false); setSkip(false);
    run();
  }

  function continueGame() {
    const d = load(KEY.auto);
    if (!d) { startNew(); return; }
    $('#screen-title').classList.remove('active');
    $('#screen-game').classList.add('active');
    restore(d);
  }

  function renderGallery() {
    const g = $('#gallery-grid');
    if (!g) return;
    g.innerHTML = '';
    const unlocked = load(KEY.endings) || {};
    Object.keys(STORY.endings).forEach(function (k) {
      const e = STORY.endings[k];
      const got = !!unlocked[k];
      const recap = got ? load(KEY.recap(k)) : null;
      const cell = document.createElement('div');
      cell.className = 'gal' + (got ? '' : ' locked') + (e.star ? ' star' : '');

      if (got) {
        /* 已解锁：显示结局画面缩略图 + 文字 + 回顾按钮 */
        cell.innerHTML =
          '<div class="gal-shot"></div>' +
          '<div class="gal-body">' +
            '<div class="gal-tag">' + e.tag + '</div>' +
            '<div class="gal-name">「' + e.name + '」</div>' +
            '<div class="gal-desc">' + e.desc + '</div>' +
            '<button class="btn gal-replay" type="button">回顾这段结局</button>' +
          '</div>';
        /* 用真实背景图 + 天气层拼出「结局截图」质感 */
        const shot = cell.querySelector('.gal-shot');
        shot.appendChild(ART.bgNode((recap && recap.bg) || 'starfield'));
        if (recap && recap.weather) {
          const w = document.createElement('div');
          w.className = 'weather gal-weather ' + recap.weather;
          for (let i = 0; i < 18; i++) w.appendChild(document.createElement('i'));
          shot.appendChild(w);
        }
        const veil = document.createElement('div');
        veil.className = 'gal-shot-veil';
        shot.appendChild(veil);

        cell.querySelector('.gal-replay').onclick = function (ev) {
          ev.stopPropagation();
          Audio2.se('click');
          openRecap(k, e, recap);
        };
      } else {
        cell.innerHTML =
          '<div class="gal-shot locked-shot"></div>' +
          '<div class="gal-body">' +
            '<div class="gal-tag">？ ？ ？</div>' +
            '<div class="gal-name">— 未解锁 —</div>' +
            '<div class="gal-desc">抵达这个结局后，这里会亮起来。</div>' +
          '</div>';
      }
      g.appendChild(cell);
    });
    const n = Object.keys(unlocked).length;
    const total = Object.keys(STORY.endings).length;
    const p = $('#gallery-progress');
    if (p) p.textContent = '已解锁 ' + n + ' / ' + total + ' 个结局';
  }

  /* ---------------- 结局回顾 ---------------- */
  function openRecap(k, e, recap) {
    const ov = $('#overlay');
    ov.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel recap-panel';

    const lines = (recap && recap.lines) || [];
    let html =
      '<div class="recap-head">' +
        '<div class="recap-tag">' + (e.tag || '') + '</div>' +
        '<h3 class="recap-name">「' + e.name + '」</h3>' +
        '<div class="recap-desc">' + (e.desc || '') + '</div>' +
      '</div>' +
      '<div class="recap-scene" id="recap-scene"></div>' +
      '<div class="recap-lines" id="recap-lines"></div>' +
      '<button class="btn" id="recap-close">关闭</button>';
    panel.innerHTML = html;
    ov.appendChild(panel);
    ov.classList.add('show');

    /* 结局画面：与当时一致的背景 + 天气 */
    const scene = panel.querySelector('#recap-scene');
    scene.appendChild(ART.bgNode((recap && recap.bg) || 'starfield'));
    if (recap && recap.weather) {
      const w = document.createElement('div');
      w.className = 'weather ' + recap.weather;
      for (let i = 0; i < 26; i++) w.appendChild(document.createElement('i'));
      scene.appendChild(w);
    }

    /* 结局文本：逐行呈现，带说话人 */
    const box = panel.querySelector('#recap-lines');
    if (!lines.length) {
      box.innerHTML = '<p class="recap-empty">还没有这段结局的回顾记录。重新抵达一次即可生成。</p>';
    } else {
      lines.forEach(function (it) {
        const p = document.createElement('p');
        p.className = 'recap-line' + (it.name ? ' has-name' : '');
        p.innerHTML = it.name
          ? '<b>' + it.name + '</b>' + it.text
          : '<i>' + it.text + '</i>';
        box.appendChild(p);
      });
    }

    panel.querySelector('#recap-close').onclick = closeOverlay;
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind() {
    $('#btn-start').onclick = function () { Audio2.se('select'); startNew(); };
    $('#btn-continue').onclick = function () { Audio2.se('select'); continueGame(); };
    $('#btn-load').onclick = function () { Audio2.resume(); openOverlay('load'); };
    $('#btn-gallery').onclick = function () { Audio2.resume(); $('#gallery').classList.add('show'); renderGallery(); };
    $('#btn-config').onclick = function () { Audio2.resume(); openOverlay('config'); };
    $('#gallery-close').onclick = function () { $('#gallery').classList.remove('show'); };
    $('#btn-continue').classList.toggle('hidden', !load(KEY.auto));

    $('#btn-menu').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); openOverlay('menu'); };
    $('#btn-save').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); openOverlay('save'); };
    $('#btn-loadq').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); openOverlay('load'); };
    $('#btn-auto').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); setAuto(!S.auto); };
    $('#btn-skip').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); setSkip(!S.skip); };
    $('#btn-hist').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); openOverlay('history'); };
    $('#btn-cfgq').onclick = function (e) { e.stopPropagation(); Audio2.se('click'); openOverlay('config'); };

    $('#click-area').onclick = function () { advance(); };
    $('#overlay').onclick = function (e) { if (e.target === $('#overlay')) closeOverlay(); };
    $('#ending-back').onclick = function () { backToTitle(); };

    document.addEventListener('keydown', function (e) {
      if (!S.started) return;
      if (e.key === 'Escape') {
        if ($('#overlay').classList.contains('show')) closeOverlay();
        else openOverlay('menu');
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault(); advance();
      } else if (e.key === 'a' || e.key === 'A') { setAuto(!S.auto); }
      else if (e.key === 'h' || e.key === 'H') { openOverlay('history'); }
      else if (e.key === 's' || e.key === 'S') { openOverlay('save'); }
      else if (e.key === 'l' || e.key === 'L') { openOverlay('load'); }
      else if (e.key === 'F5') { e.preventDefault(); quickSave(); }
      else if (e.key === 'F9') { e.preventDefault(); quickLoad(); }
      else if (e.key === 'Control') { setSkip(true); }
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'Control') setSkip(false);
    });

    window.addEventListener('beforeunload', function () { save(KEY.seen, S.seen); });

    Audio2.setVolume('bgm', CONFIG.bgm / 100);
    Audio2.setVolume('se', CONFIG.se / 100);
  }

  /* 启动 */
  function boot() {
    bind();
    applyConfig();
    $('#title-bg').replaceChildren(ART.bgNode('corridor_dusk'));
    $('#title-name').textContent = STORY.title;
    $('#title-sub').textContent = STORY.subtitle;
    $('#title-author').textContent = STORY.author;
    try {
      const ctx = Audio2.init();
      if (ctx) Audio2.playBgm('title');
    } catch (e) {}
    document.addEventListener('pointerdown', function once() {
      Audio2.resume();
      if (!S.started) Audio2.playBgm('title');
      document.removeEventListener('pointerdown', once);
    });
  }

  return { boot: boot, S: S, CONFIG: CONFIG, applyConfig: applyConfig };
})();

document.addEventListener('DOMContentLoaded', VN.boot);
