const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = 'D:/2atools/Workboddy/视觉小说-1';
const ctx = { console, window: {}, document: { addEventListener() {}, createElement: () => ({ style: {}, dataset: {} }) }, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
['js/art.js', 'js/story.js', 'js/audio.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
const STORY = vm.runInContext('STORY', ctx);
const scenes = STORY.scenes;
const labels = Object.keys(scenes);

// build edges
const edges = {};
labels.forEach(L => {
  const set = new Set();
  (scenes[L] || []).forEach(ins => {
    if (ins.jump || ins.goto) set.add(ins.jump || ins.goto);
    if (ins.choice) ins.choice.options.forEach(o => set.add(o.goto));
    if (ins.branch) ins.branch.forEach(b => set.add(Array.isArray(b) ? b[1] : b));
  });
  edges[L] = [...set];
});

// reverse edges (who points here)
const rev = {};
labels.forEach(L => { rev[L] = []; });
labels.forEach(L => edges[L].forEach(t => { if (rev[t]) rev[t].push(L); }));

const out = [];
out.push('=== 孤儿 / 无出边 场景 ===');
labels.forEach(L => {
  const noIn = rev[L].length === 0;
  const noOut = edges[L].length === 0;
  const isEnd = (scenes[L] || []).some(i => i.end);
  if (noIn && L !== STORY.start) out.push('  无入边: ' + L);
  if (noOut && !isEnd) out.push('  无出边且非结局: ' + L);
});

out.push('');
out.push('=== 结局 → 可达路径（谁 jump/end 到它） ===');
const endLabels = {};
labels.forEach(L => (scenes[L] || []).forEach(i => { if (i.end) endLabels[i.end] = L; }));
Object.keys(STORY.endings).forEach(k => {
  const L = endLabels[k];
  out.push('  ' + k + '  <=  ' + (L || '??') + '  <=  [' + ((rev[L] || []).join(', ') || '无') + ']');
});

out.push('');
out.push('=== 全部场景出边 ===');
labels.forEach(L => {
  out.push('  ' + L + ' -> ' + (edges[L].join(', ') || '(结局/终止)'));
});

fs.writeFileSync(path.join(ROOT, '_graph.txt'), out.join('\n'), 'utf8');
