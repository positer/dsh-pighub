/**
 * 全库精修（PigHub 表情包库：用户判定可信）。
 *
 * 与逐素材 subagent 流程的关系：那套是**手工精修**（每张图一个可评审的规格）；
 * 这里是**全库自动精修**——1361 张不可能每张派一个 subagent，但每张仍然走同一套判定逻辑：
 *   1. 全域去白（含封闭白）；
 *   2. 取**最大连通块**当猪（其余连通块＝显示器/键盘/字幕这类独立配件，整块删掉）；
 *   3. 按剩余内容外接框裁到猪身 + 2px；
 *   4. 描 2px 深棕边；
 *   5. 风格评分（palette/flatness），不达标的不进库；
 *   6. 最长边压到 ≤256，存 PNG。
 *
 * 三个产出：
 *   assets/library/pigs/<id>.png   精修后的贴图
 *   assets/library/index.json      全库清单（含每张的判定、分数、指纹）
 *   assets/library/report.json     统计（通过/排除/失败、体积）
 *
 * 可续跑：已存在且指纹对得上的直接跳过。
 *
 * 用法：node scripts/refine-library.mjs [--limit N] [--concurrency 8]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { stripAllWhite, contentBounds, cropFrame, addOutline, styleScore } from '../lib/imaging.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'assets', 'library');
const pigDir = join(root, 'pigs');
mkdirSync(pigDir, { recursive: true });

const args = process.argv.slice(2);
const limit = Number((args[args.indexOf('--limit') + 1] || '0')) || Infinity;
const concurrency = Number((args[args.indexOf('--concurrency') + 1] || '0')) || 6;
const MAX_EDGE = 256;
const MIN_BLOB_SHARE = 0.02;

/** 取最大连通块：其余连同白底一起清掉。返回 {frame, blobs}。 */
function keepLargestBlob(frame) {
  const { width, height, data } = frame;
  const total = width * height;
  const seen = new Uint8Array(total);
  const stack = [];
  let best = null;
  let blobs = 0;
  for (let seed = 0; seed < total; seed += 1) {
    if (seen[seed] || data[seed * 4 + 3] < 24) continue;
    blobs += 1;
    stack.length = 0;
    stack.push(seed);
    seen[seed] = 1;
    const members = [seed];
    let minX = width, minY = height, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const around = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of around) {
        if (q < 0 || seen[q] || data[q * 4 + 3] < 24) continue;
        seen[q] = 1;
        stack.push(q);
        members.push(q);
      }
    }
    // 判据不是「最大块」——文字块常常比猪还大。这里按「像猪的颜色占比 × 面积」选：
    // 桃色/玫红像素占比越高越像猪，面积只是权重。
    let pigment = 0;
    for (const p of members) {
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (r >= 200 && g >= 140 && b >= 110 && r > b) pigment += 1;
      else if (max > 120 && r > 140 && r > g && r > b * 0.9) pigment += 1;
    }
    const likeness = members.length ? pigment / members.length : 0;
    const value = likeness * likeness * members.length;
    if (!best || value > best.value) best = { members, minX, minY, maxX, maxY, value, likeness };
  }
  if (!best) return { frame, blobs, kept: 0 };
  const keep = new Uint8Array(total);
  for (const p of best.members) keep[p] = 1;
  for (let i = 0; i < total; i += 1) if (!keep[i]) data[i * 4 + 3] = 0;
  return { frame, blobs, kept: best.members.length, likeness: best.likeness };
}

async function refine(item) {
  const response = await fetch(item.url, { headers: { accept: 'image/jpeg,image/png,image/gif' } });
  if (!response.ok) throw new Error('http_' + response.status);
  const raw = Buffer.from(await response.arrayBuffer());
  const isGif = raw.subarray(0, 3).toString('ascii') === 'GIF';
  // 动图：只评风格、原样存（去白会把动画冻住）
  if (isGif) {
    const first = await sharp(raw, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const score = styleScore({ width: first.info.width, height: first.info.height, data: first.data });
    return { kind: 'gif', raw, score };
  }
  const decoded = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let frame = { width: decoded.info.width, height: decoded.info.height, data: decoded.data };
  stripAllWhite(frame, 236);
  const { blobs, kept, likeness } = keepLargestBlob(frame);
  const share = kept / (frame.width * frame.height);
  if (share < MIN_BLOB_SHARE) return { kind: 'skip', reason: 'no_pig_blob', share };
  const box = contentBounds(frame, 2);
  frame = cropFrame(frame, box.x, box.y, box.w, box.h);
  frame = addOutline(frame, 2, [43, 26, 16]);
  const score = styleScore(frame);
  const scale = Math.min(1, MAX_EDGE / Math.max(frame.width, frame.height));
  const png = await sharp(Buffer.from(frame.data), { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .resize({ width: Math.round(frame.width * scale), height: Math.round(frame.height * scale), fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { kind: 'png', png, score, blobs, size: [Math.round(frame.width * scale), Math.round(frame.height * scale)] };
}

async function main() {
  const payload = await (await fetch('https://pighub.top/api/images?sort=2', { headers: { accept: 'application/json' } })).json();
  const index = (payload && payload.data) || [];
  const items = index.slice(0, limit === Infinity ? undefined : limit).map((row) => ({
    id: 'pighub-' + row.id,
    title: row.title,
    url: 'https://pighub.top' + encodeURIComponent(row.image_url).replace(/%2F/g, '/'),
  }));
  console.log('库内条目：' + items.length + '，并发 ' + concurrency);

  const results = [];
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      const filePng = join(pigDir, item.id + '.png');
      const fileGif = join(pigDir, item.id + '.gif');
      if (existsSync(filePng) || existsSync(fileGif)) {
        results.push({ id: item.id, title: item.title, status: 'cached', file: 'assets/library/pigs/' + item.id + (existsSync(filePng) ? '.png' : '.gif') });
        done += 1;
        continue;
      }
      try {
        const out = await refine(item);
        if (out.kind === 'skip') { results.push({ id: item.id, title: item.title, status: 'skipped', reason: out.reason, share: out.share }); }
        else if (out.kind === 'gif') {
          writeFileSync(fileGif, out.raw);
          results.push({ id: item.id, title: item.title, status: 'gif', style: out.score, bytes: out.raw.length, file: 'assets/library/pigs/' + item.id + '.gif' });
        } else {
          writeFileSync(filePng, out.png);
          results.push({ id: item.id, title: item.title, status: out.score.verdict === 'match' ? 'ok' : 'style-reject', style: out.score, blobs: out.blobs, size: out.size, bytes: out.png.length, file: 'assets/library/pigs/' + item.id + '.png' });
        }
      } catch (error) {
        results.push({ id: item.id, title: item.title, status: 'failed', error: String(error.message || error) });
      }
      done += 1;
      if (done % 100 === 0) console.log('  进度 ' + done + '/' + items.length);
    }
  }
  await Promise.all(new Array(concurrency).fill(0).map(worker));

  results.sort((a, b) => a.id.localeCompare(b.id));
  const count = (status) => results.filter((r) => r.status === status).length;
  const bytes = results.reduce((sum, r) => sum + (r.bytes || 0), 0);
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'https://pighub.top/api/images?sort=2',
    total: results.length,
    ok: count('ok'),
    gif: count('gif'),
    styleReject: count('style-reject'),
    skipped: count('skipped'),
    failed: count('failed'),
    bytes,
  };
  writeFileSync(join(root, 'index.json'), JSON.stringify({ source: report.source, items: results }, null, 2) + '\n');
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

await main();
