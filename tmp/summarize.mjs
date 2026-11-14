
import { readFileSync, writeFileSync } from 'node:fs';
const E = 'archive/20261114-153555-drag-drop-origin/evidence';
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const conditions = ['before-async-dom', 'before-sync-dom', 'after-async-dom', 'after-sync-dom'];
const out = { measure: 'getComputedStyle(left) 插值 = 浏览器这一帧画在哪; 可见帧 = opacity>0.5', rows: [] };
for (const c of conditions) {
  const j = JSON.parse(readFileSync(E + '/' + c + '.json', 'utf8'));
  for (const r of j.runs) {
    const visible = r.series.filter((x) => x && x.phase !== 'drag' && Number(x.opacity) > 0.5);
    if (!visible.length) continue;
    const first = visible[0];
    const last = visible[visible.length - 1];
    const toward = Math.sign(r.expectPct.x - r.startPct.x) || 1;
    let rev = 0, fwd = 0, prev = first;
    for (const x of visible.slice(1)) {
      const d = x.leftPct - prev.leftPct;
      if (d * toward < -0.05) rev += Math.abs(d); else if (d * toward > 0.05) fwd += Math.abs(d);
      prev = x;
    }
    out.rows.push({
      condition: c, bundle: j.bundle, effects: j.effects, run: r.run,
      startPctX: round(r.startPct.x), landPctX: round(r.expectPct.x),
      firstVisible_t_ms: first.t,
      firstVisiblePctX: round(first.leftPct), firstVisibleErrPx: round(Math.abs(first.leftPct - r.expectPct.x) / 100 * r.pen.width, 2),
      firstVisibleErrYpx: round(Math.abs(first.topPct - r.expectPct.y) / 100 * r.pen.height, 2),
      finalPctX: round(last.leftPct), finalErrPx: round(Math.abs(last.leftPct - r.expectPct.x) / 100 * r.pen.width, 2),
      reversePctX: round(rev), forwardPctX: round(fwd),
      visibleSamples: visible.length,
    });
  }
}
const pixels = { rows: [] };
for (const c of ['before-pixels', 'after-pixels']) {
  const j = JSON.parse(readFileSync(E + '/' + c + '.json', 'utf8'));
  for (const r of j.shotRuns) {
    const w = r.pen.width;
    const pre = r.frames.filter((x) => x.label === 'pre-drop' && x.cx != null);
    const post = r.frames.filter((x) => x.label === 'post' && x.cx != null);
    const pcts = post.map((x) => (x.cx / w) * 100);
    pixels.rows.push({
      condition: c, run: r.run,
      frameGapMedianMs: (() => { const g = []; for (let i = 1; i < r.frames.length; i += 1) g.push(r.frames[i].t - r.frames[i - 1].t); g.sort((a, b) => a - b); return g[Math.floor(g.length / 2)]; })(),
      lastDragCentroidPct: round(pre[pre.length - 1].cx / w * 100),
      postFirstCentroidPct: round(pcts[0]),
      landingJumpPx: round((pcts[0] - pre[pre.length - 1].cx / w * 100) / 100 * w, 1),
      postWindowDisplacementPx: round((pcts[pcts.length - 1] - pcts[0]) / 100 * w, 1),
      postWindowSwingPx: round((Math.max(...pcts) - Math.min(...pcts)) / 100 * w, 1),
      frames: r.frames.length,
    });
  }
}
out.pixels = pixels;
writeFileSync(E + '/summary.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.rows, null, 1));
console.log(JSON.stringify(pixels.rows, null, 1));
