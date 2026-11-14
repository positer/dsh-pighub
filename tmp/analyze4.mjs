
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  console.log('==', f.split(/[\\/]/).pop(), 'effects=' + j.effects, 'bundle=' + j.bundle);
  for (const r of j.shotRuns) {
    const w = r.pen.width;
    const post = r.frames.filter((x) => x.label === 'post' && x.cx != null);
    const pre = r.frames.filter((x) => x.label === 'pre-drop' && x.cx != null);
    const gaps = [];
    for (let i = 1; i < r.frames.length; i += 1) gaps.push(r.frames[i].t - r.frames[i - 1].t);
    const pcts = post.map((x) => (x.cx / w) * 100);
    const landJump = pre.length && post.length ? (post[0].cx - pre[pre.length - 1].cx) / w * 100 : null;
    console.log(JSON.stringify({
      run: r.run,
      frameGapMedianMs: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)],
      frames: r.frames.length,
      lastDragPct: pre.length ? Math.round(pre[pre.length - 1].cx / w * 10000) / 100 : null,
      postFirstPct: post.length ? Math.round(pcts[0] * 100) / 100 : null,
      postLastPct: post.length ? Math.round(pcts[pcts.length - 1] * 100) / 100 : null,
      postMinusFirstPx: post.length ? Math.round((pcts[pcts.length - 1] - pcts[0]) / 100 * w * 10) / 10 : null,
      postSwingPx: post.length ? Math.round((Math.max(...pcts) - Math.min(...pcts)) / 100 * w * 10) / 10 : null,
      landingJumpPx: landJump == null ? null : Math.round(landJump / 100 * w * 10) / 10,
    }));
  }
}
