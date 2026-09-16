/* ============================================================
 * check-story.js —— 剧本与资源校验
 * 用法：node check-story.js
 * 校验内容：
 *   1. 场景引用的背景 / 立绘 / BGM / 音效 / 跳转 / 结局是否都已登记
 *   2. 是否存在不可达场景、没有入口的结局
 *   3. 统计规模，并在有真画稿时核对素材文件是否存在
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = __dirname;
const ctx = {
  console,
  window: {},
  document: { addEventListener() {}, createElement: () => ({ style: {}, dataset: {} }) },
  localStorage: { getItem: () => null, setItem() {} }
};
vm.createContext(ctx);

['js/art.js', 'js/story.js', 'js/audio.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { console.error('语法错误 ' + f + ' -> ' + e.message); process.exit(1); }
});

const STORY = vm.runInContext('STORY', ctx);
const ART   = vm.runInContext('ART', ctx);
const AUDIO_N = ['click', 'chime', 'paper', 'mailbox', 'heartbeat', 'select'];

const labels = Object.keys(STORY.scenes);
let err = 0;
const chk = (ok, msg) => { if (!ok) { console.log('  !! ' + msg); err++; } };

/* ---------- 1. 引用检查 ---------- */
labels.forEach(L => {
  (STORY.scenes[L] || []).forEach((ins, i) => {
    const at = L + '[' + i + ']';
    if (ins.bg !== undefined) {
      const s = ART.bgSource(ins.bg);
      chk(!!s, at + ' 背景不存在: ' + ins.bg);
      if (s && s.type === 'svg') s.svg.indexOf('ph') !== -1 &&
        console.log('  ~~ ' + at + ' 背景「' + ins.bg + '」暂无画稿，正在使用兜底渐变');
    }
    if (ins.se) chk(AUDIO_N.includes(ins.se), at + ' 音效未定义: ' + ins.se);
    if (ins.show) {
      const src = ART.charSource(ins.show, ins.pose || 'normal');
      if (!src) console.log('  ~~ ' + at + ' 立绘「' + ins.show + '」暂无画稿，将显示剪影占位');
    }
    if (ins.say !== undefined) chk(ins.text !== undefined, at + ' say 缺少 text');
    if (ins.jump || ins.goto) chk(labels.includes(ins.jump || ins.goto),
      at + ' 跳转目标不存在: ' + (ins.jump || ins.goto));
    if (ins.choice) (ins.choice.options || []).forEach((o, j) =>
      chk(labels.includes(o.goto), at + ' 选项[' + j + '] 目标不存在: ' + o.goto));
    if (ins.branch) ins.branch.forEach(b =>
      chk(labels.includes(Array.isArray(b) ? b[1] : b), at + ' 分支目标不存在'));
    if (ins.end) chk(STORY.endings[ins.end], at + ' 结局未定义: ' + ins.end);
  });
});

/* ---------- 2. 可达性 ---------- */
const reach = new Set([STORY.start]), q = [STORY.start];
while (q.length) {
  const L = q.pop();
  (STORY.scenes[L] || []).forEach(ins => {
    const g = [];
    if (ins.jump || ins.goto) g.push(ins.jump || ins.goto);
    if (ins.choice) ins.choice.options.forEach(o => g.push(o.goto));
    if (ins.branch) ins.branch.forEach(b => g.push(Array.isArray(b) ? b[1] : b));
    g.forEach(t => { if (!reach.has(t)) { reach.add(t); q.push(t); } });
  });
}
labels.forEach(L => { if (!reach.has(L)) { console.log('  ?? 不可达场景: ' + L); err++; } });

/* ---------- 3. 结局入口 ---------- */
const ends = new Set();
labels.forEach(L => (STORY.scenes[L] || []).forEach(i => { if (i.end) ends.add(i.end); }));
Object.keys(STORY.endings).forEach(k =>
  chk(ends.has(k), '结局「' + STORY.endings[k].name + '」没有入口'));

/* ---------- 4. 素材文件核对 ---------- */
let missingFiles = 0;
Object.keys(ART.PHOTO.bg).forEach(k => {
  const p = path.join(ROOT, ART.PHOTO.bg[k]);
  if (!fs.existsSync(p)) { console.log('  !! 背景画稿文件缺失: ' + ART.PHOTO.bg[k]); missingFiles++; }
});
Object.keys(ART.PHOTO.char).forEach(id => {
  Object.keys(ART.PHOTO.char[id]).forEach(pose => {
    const p = path.join(ROOT, ART.PHOTO.char[id][pose]);
    if (!fs.existsSync(p)) { console.log('  !! 立绘文件缺失: ' + ART.PHOTO.char[id][pose]); missingFiles++; }
  });
});
err += missingFiles;

/* ---------- 5. 规模统计 ---------- */
let lines = 0, chars = 0;
const bgUsed = new Set(), charUsed = new Set();
labels.forEach(L => (STORY.scenes[L] || []).forEach(i => {
  const t = i.text || i.t;
  if (t) { lines++; chars += t.length; }
  if (i.bg) bgUsed.add(i.bg);
  if (i.show) charUsed.add(i.show);
}));

console.log('\n场景 ' + labels.length + ' 个 / 对白旁白 ' + lines + ' 句 / 约 ' + chars + ' 字 / 结局 ' + ends.size + ' 个');
console.log('引用背景 ' + bgUsed.size + ' 张（已有画稿 ' + Object.keys(ART.PHOTO.bg).length + ' 张）');
console.log('出场角色 ' + charUsed.size + ' 位（已有立绘 ' + Object.keys(ART.PHOTO.char).join('、') + '）');
console.log(err ? '\n发现 ' + err + ' 个问题' : '\n全部检查通过');
