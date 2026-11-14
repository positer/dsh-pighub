
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const j = JSON.parse(readFileSync(file, 'utf8'));
const round = (n) => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
for (const r of j.runs) {
  // 只看**可见**的采样（opacity > 0.5）：拖动中本体是隐藏的，那时它在旧位置
  const visible = r.series.filter((x) => x && x.phase !== 'drag' && Number(x.opacity) > 0.5);
  const rel = visible.filter((x) => x.t >= (r.dropAtMs != null ? r.dropAtMs : 0));
  if (!visible.length) { console.log('run', r.run, 'no visible samples'); continue; }
  const first = visible[0];
  const last = visible[visible.length - 1];
  // 反向位移：相对落点方向的"回头"量（落点方向 = expect - start）
  let rev = 0, fwd = 0, prev = first;
  for (const x of visible.slice(1)) {
    const d = x.leftPct - prev.leftPct;
    const towardLanding = Math.sign(r.expectPct.x - r.startPct.x) || 1;
    if (d * towardLanding < -0.05) rev += Math.abs(d);
    else if (d * towardLanding > 0.05) fwd += Math.abs(d);
    prev = x;
  }
  const errFirst = Math.abs(first.leftPct - r.expectPct.x) / 100 * r.pen.width;
  const errLast = Math.abs(last.leftPct - r.expectPct.x) / 100 * r.pen.width;
  const errFirstY = Math.abs(first.topPct - r.expectPct.y) / 100 * r.pen.height;
  const errLastY = Math.abs(last.topPct - r.expectPct.y) / 100 * r.pen.height;
  // 反向段：从第一帧之后开始，任何连续反向的累计
  console.log(JSON.stringify({
    run: r.run, startPct: round(r.startPct.x), landPct: round(r.expectPct.x),
    firstVisible: { t: first.t, x: round(first.leftPct), y: round(first.topPct), errPx: round(errFirst), errYpx: round(errFirstY) },
    final: { t: last.t, x: round(last.leftPct), y: round(last.topPct), errPx: round(errLast), errYpx: round(errLastY) },
    reversePct: round(rev), forwardPct: round(fwd), samples: visible.length,
  }));
}
