
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { stripAllWhite, contentBounds, cropFrame, addOutline, styleScore, eraseRects } from './lib/imaging.js';

const SRC = 'test/demo/vendor/pigs/pig-1358.webp';
const dec = await sharp(readFileSync(SRC)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const frame = { width: dec.info.width, height: dec.info.height, data: dec.data };
const W = frame.width, H = frame.height;
const N = (v, d) => Number(v.toFixed(d));

// 目标像素框（原图绝对像素，半开区间）→ 归一化
const ABS = [
  [439, 320, 4, 4],    // 尾部右侧 3 个近白噪点
  [437, 389, 3, 3],    // (438,390)
  [438, 440, 3, 3],    // (439,441)
  [443, 447, 3, 3],    // (444,448)
  [276, 449, 5, 4],    // (279,451) 萝卜尖左侧
  [226, 455, 264, 4],  // 底边一条：杂点 (232,458)，同时给裁切框收口
];
const spec = {
  id: 'pig-1358',
  trim: [N(226/W,6), N(83/H,6), N(264/W,6), N(376/H,6)],
  white: 236, whiteAll: true, keep: [],
  erase: ABS.map(([x,y,w,h]) => [N(x/W,6), N(y/H,6), N(w/W,6), N(h/H,6)]),
  outline: { width: 3, color: [43,26,16] },
};

const trim = spec.trim;
const tx = Math.max(0, Math.round(W*trim[0])), ty = Math.max(0, Math.round(H*trim[1]));
const tw = Math.max(1, Math.round(W*trim[2])), th = Math.max(1, Math.round(H*trim[3]));
const trimmed = cropFrame(frame, tx, ty, tw, th);
const toFrame = (r) => [(r[0]-trim[0])/trim[2], (r[1]-trim[1])/trim[3], r[2]/trim[2], r[3]/trim[3]];
stripAllWhite(trimmed, spec.white);
const mapBack = spec.erase.map((r) => {
  const f = toFrame(r);
  const x0 = Math.max(0, Math.round(trimmed.width*f[0]));
  const y0 = Math.max(0, Math.round(trimmed.height*f[1]));
  const x1 = Math.min(trimmed.width, Math.round(trimmed.width*(f[0]+f[2])));
  const y1 = Math.min(trimmed.height, Math.round(trimmed.height*(f[1]+f[3])));
  let op = 0;
  for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) if (trimmed.data[(y*trimmed.width+x)*4+3] > 24) op++;
  return { abs: [tx+x0, ty+y0, x1-x0, y1-y0], opaqueInside: op };
});
eraseRects(trimmed, spec.erase.map(toFrame));
const box = contentBounds(trimmed, 1);
let cropped = cropFrame(trimmed, box.x, box.y, box.w, box.h);
cropped = addOutline(cropped, spec.outline.width, spec.outline.color);
const st = styleScore(cropped);
let opaque = 0;
for (let i=0;i<cropped.width*cropped.height;i++) if (cropped.data[i*4+3] > 24) opaque++;
console.log('SPEC', JSON.stringify(spec));
console.log('TRIM px', [tx,ty,tw,th].join(','), 'contentBox', JSON.stringify(box), 'size', cropped.width+'x'+cropped.height);
console.log('MAPPED erase abs rects + opaque px inside:');
mapBack.forEach((m,i) => console.log('  ', i, JSON.stringify(m), 'target', JSON.stringify(ABS[i])));
console.log('STYLE', JSON.stringify(st), 'opaque', opaque);
writeFileSync('../evidence/_pig1358_spec.json', JSON.stringify(spec, null, 2));
await sharp(Buffer.from(cropped.data), { raw: { width: cropped.width, height: cropped.height, channels: 4 } }).png().toFile('../evidence/_pig1358_final2.png');
console.log('ok');
