/**
 * 角色卡集体校验：逐张判「是不是角色」与「角色名去没去干净」。
 *
 * 判据（都可复核，不靠目测）：
 *   1. background_left —— 四角仍有不透明像素（≥2 角）说明整张卡片还在，背景没去掉；
 *   2. text_line       —— 存在「一排横向排列的小深色块」：文字行的特征（≥3 块、纵向中心接近、横向铺开）；
 *      （眼睛/鼻孔是 2`4 块竖排或居中聚集，凑不出「一排」）
 *   3. extra_blob      —— 与主体分离的独立连通块（配件/水印）。
 * 只给数字与标记，不臆造结论。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const index = JSON.parse(readFileSync(join(root, 'assets', 'cards', 'index.json'), 'utf8'));

function analyse(data, width, height) {
  const total = width * height;
  let opaque = 0;
  const dark = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] < 24) continue;
    opaque += 1;
    const v = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (v > 80) continue;
    // 排除本项目自己加的描边色 (43,26,16)
    const near = Math.abs(data[i * 4] - 43) + Math.abs(data[i * 4 + 1] - 26) + Math.abs(data[i * 4 + 2] - 16);
    if (near <= 30) continue;
    dark[i] = 1;
  }
  const seen = new Uint8Array(total);
  const stack = [];
  const darkBoxes = [];
  let blobs = 0, big = 0;
  for (let seed = 0; seed < total; seed += 1) {
    if (seen[seed] || data[seed * 4 + 3] < 24) continue;
    blobs += 1;
    stack.length = 0; stack.push(seed); seen[seed] = 1;
    let area = 0;
    while (stack.length) {
      const p = stack.pop(); area += 1;
      const x = p % width; const y = (p - x) / width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q < 0 || seen[q] || data[q * 4 + 3] < 24) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    if (area > big) big = area;
  }
  // 深色小块的 bbox
  const seenDark = new Uint8Array(total);
  for (let seed = 0; seed < total; seed += 1) {
    if (!dark[seed] || seenDark[seed]) continue;
    stack.length = 0; stack.push(seed); seenDark[seed] = 1;
    let area = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    while (stack.length) {
      const p = stack.pop(); area += 1;
      const x = p % width; const y = (p - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q < 0 || seenDark[q] || !dark[q]) continue;
        seenDark[q] = 1; stack.push(q);
      }
    }
    if (area >= 12) darkBoxes.push({ area, minX, maxX, minY, maxY, cy: (minY + maxY) / 2 });
  }
  // 文字行：≥3 个深色块，纵向中心落在 12% 高度内，横向铺开 > 25% 宽度
  let textLine = 0;
  for (let i = 0; i < darkBoxes.length; i += 1) {
    const band = darkBoxes.filter((box) => Math.abs(box.cy - darkBoxes[i].cy) <= height * 0.12);
    if (band.length < 3) continue;
    const spread = Math.max(...band.map((b) => b.maxX)) - Math.min(...band.map((b) => b.minX));
    if (spread > width * 0.25) textLine = Math.max(textLine, band.length);
  }
  const corners = [
    data[(0 * width + 0) * 4 + 3],
    data[(0 * width + width - 1) * 4 + 3],
    data[((height - 1) * width + 0) * 4 + 3],
    data[((height - 1) * width + width - 1) * 4 + 3],
  ];
  return { opaque, blobs, big, darkBoxes: darkBoxes.length, textLine, corners };
}

const rows = [];
for (const card of index.cards) {
  if (card.kind !== 'static' || !card.file) { rows.push({ id: card.id, title: card.title, kind: card.kind, verdict: 'n/a', flags: [] }); continue; }
  const { data, info } = await sharp(join(root, card.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats = analyse(data, info.width, info.height);
  const flags = [];
  if (stats.corners.filter((alpha) => alpha > 40).length >= 2) flags.push('background_left');
  if (stats.textLine >= 3) flags.push('text_line');
  if (stats.blobs > 1) flags.push('extra_blob');
  rows.push({
    id: card.id, title: card.title, kind: card.kind, file: card.file, size: card.size,
    style: card.style ? (card.style.palette + '/' + card.style.flatness) : '-',
    darkBoxes: stats.darkBoxes, textLine: stats.textLine, blobs: stats.blobs,
    corners: stats.corners.join('/'), flags, verdict: flags.length ? 'flagged' : 'pass',
  });
}

const pass = rows.filter((row) => row.verdict === 'pass');
const flagged = rows.filter((row) => row.verdict === 'flagged');
writeFileSync(join(root, 'assets', 'cards', 'verify.json'), JSON.stringify({
  checkedAt: new Date().toISOString(),
  total: rows.length, pass: pass.length, flagged: flagged.length,
  criteria: { background_left: '≥2 个角仍有不透明像素', text_line: '≥3 个深色小块排成一行（文字行特征）', extra_blob: '与主体分离的独立连通块' },
  rows,
}, null, 2) + '\n');
console.log('通过 ' + pass.length + ' / 标记 ' + flagged.length + ' / 共 ' + rows.length + ' 张');
for (const row of rows) {
  console.log('  ' + (row.verdict === 'pass' ? 'PASS ' : row.verdict === 'n/a' ? '  -- ' : 'FLAG ') + String(row.id).padEnd(13) + String(row.title || '').slice(0, 11).padEnd(12) + ' darkBoxes=' + String(row.darkBoxes).padEnd(3) + ' textLine=' + String(row.textLine).padEnd(3) + ' blobs=' + String(row.blobs).padEnd(3) + (row.flags.length ? row.flags.join(',') : ''));
}
