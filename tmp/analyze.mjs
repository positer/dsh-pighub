
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const j = JSON.parse(readFileSync(file, 'utf8'));
const round = (n) => Math.round(n * 100) / 100;
for (const r of j.runs) {
  const post = r.series.filter((x) => x && x.phase !== 'drag');
  const nulls = r.series.filter((x) => !x).length;
  let minX = 1e9, maxX = -1e9, rev = 0, fwd = 0, prev = null, backSeg = null, curBack = 0;
  for (const x of post) {
    if (!x) continue;
    if (x.leftPct < minX) minX = x.leftPct;
    if (x.leftPct > maxX) maxX = x.leftPct;
    if (prev) {
      const d = x.leftPct - prev.leftPct;
      if (d < -0.05) { rev += -d; curBack += -d; }
      else if (d > 0.05) { if (curBack > (backSeg ? backSeg.dist : 0)) backSeg = { dist: curBack, from: prev.leftPct }; curBack = 0; fwd += d; }
    }
    prev = x;
  }
  if (curBack > (backSeg ? backSeg.dist : 0)) backSeg = { dist: curBack, from: prev ? prev.leftPct : null };
  const last = post.filter(Boolean).pop();
  console.log('run', r.run, '| start', round(r.startPct.x), 'dropExpect', round(r.expectPct.x),
    '| min', round(minX), 'max', round(maxX), '| reverse', round(rev), 'forward', round(fwd),
    '| final', last ? round(last.leftPct) : null, 'errPct', last ? round(Math.abs(last.leftPct - r.expectPct.x)) : null,
    'errPx', last ? round(Math.abs(last.leftPct - r.expectPct.x) / 100 * r.pen.width) : null, '| nullSamples', nulls);
}
const r0 = j.runs[0];
console.log('\n--- run1 series (t<1600 or every 6th) ---');
r0.series.forEach((s, i) => {
  if (!s) { console.log(i, 'NULL'); return; }
  if (s.t < 1600 || i % 8 === 0) console.log(s.t, s.phase, s.leftPct, s.topPct, s.declLeft, s.transitionDuration, s.cls, 'op=' + s.opacity);
});
