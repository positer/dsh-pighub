
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const j = JSON.parse(readFileSync(file, 'utf8'));
const round = (n) => Math.round(n * 100) / 100;
for (const r of j.shotRuns) {
  const w = r.pen.width;
  const frames = r.frames;
  const pre = frames.filter((f) => f.label === 'pre-drop');
  const post = frames.filter((f) => f.label === 'post');
  const pct = (c) => (c == null ? null : (c / w) * 100);
  const land = r.expectPct.x;
  let rev = 0, prev = null;
  for (const f of post) {
    if (f.cx == null) continue;
    if (prev != null && f.cx < prev - 1) rev += (prev - f.cx) / w * 100;
    prev = f.cx;
  }
  const firstPost = post.find((f) => f.cx != null);
  console.log(JSON.stringify({
    run: r.run, landPct: round(land),
    preDropPct: pre.map((f) => round(pct(f.cx))),
    firstPost: { t: firstPost ? firstPost.t : null, pct: firstPost ? round(pct(firstPost.cx)) : null, errPx: firstPost ? round(Math.abs(firstPost.cx - land / 100 * w)) : null },
    postFirst5: post.slice(0, 5).map((f) => ({ t: f.t, pct: round(pct(f.cx)), px: f.pixels })),
    postLast: post.length ? { t: post[post.length - 1].t, pct: round(pct(post[post.length - 1].cx)), px: post[post.length - 1].pixels } : null,
    reversePct: round(rev), frames: frames.length,
  }));
}
