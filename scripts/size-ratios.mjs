/**
 * 给素材库里的每只猪算一个**视觉体量归一化系数** sizeRatio（CSS px 宽度）。
 *
 * 口径（goal 验收线 1）：让每只猪渲染后的**不透明面积**尽量一致 ——
 *   ratio_i = W_i / sqrt(A_i)，再把中位数拉到 96px。
 * 于是渲染宽度 w_i = sizeRatio_i 时，sqrt(渲染后不透明面积) = sqrt(A_i) · w_i / W_i 恒定。
 *
 * 只用 Node 内置 zlib 解 PNG（素材都是 8-bit 非隔行 RGBA）；GIF/SVG 用声明尺寸估一个。
 * 用法：node scripts/size-ratios.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const manifestPath = join(root, 'assets', 'manifest.json');

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** 解 PNG：返回 { width, height, opaque }（opaque = alpha>16 的像素数）。 */
export function pngStats(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not_png');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;
  let trns = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace !== 0) throw new Error('interlaced_png_unsupported');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error('unsupported_color_type_' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = bitDepth === 8 ? channels : 1; // 8-bit 素材，其它按 1 处理（估个大概）
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const dest = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bytesPerPixel ? dest[x - bytesPerPixel] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      }
      dest[x] = value & 0xff;
    }
  }
  let opaque = 0;
  for (let i = 0; i < width * height; i += 1) {
    let alpha = 255;
    if (colorType === 6) alpha = out[i * 4 + 3];
    else if (colorType === 4) alpha = out[i * 2 + 1];
    else if (colorType === 3 && trns && palette) alpha = trns[out[i]] === undefined ? 255 : trns[out[i]];
    if (alpha > 16) opaque += 1;
  }
  return { width, height, opaque };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const rows = [];
for (const pig of manifest.pigs) {
  const file = String(pig.file || '').replace(/^assets\//, '');
  const path = join(root, 'assets', file);
  let stats = null;
  try {
    if (file.endsWith('.png')) stats = pngStats(readFileSync(path));
    // GIF/SVG 没法在纯 Node 里量 alpha：
    //   1) 清单里若已记录 sizeOpaque（用 Pillow 量一次、写进 manifest），直接用；
    //   2) 否则按「整块不透明」估（SVG 是矢量盒子，只能这样）。
    else if (pig.size) {
      stats = {
        width: pig.size.width,
        height: pig.size.height,
        opaque: Number.isFinite(pig.sizeOpaque) && pig.sizeOpaque > 0 ? pig.sizeOpaque : pig.size.width * pig.size.height,
      };
    }
  } catch (error) {
    stats = null;
  }
  if (!stats || !stats.opaque) continue;
  rows.push({ id: pig.id, width: stats.width, height: stats.height, opaque: stats.opaque, ratio: stats.width / Math.sqrt(stats.opaque) });
}
rows.sort((a, b) => a.ratio - b.ratio);
const median = rows[Math.floor(rows.length / 2)].ratio;
for (const row of rows) row.sizeRatio = Math.round((96 * row.ratio / median) * 100) / 100;

// 渲染后的"视觉体量" = sqrt(渲染不透明面积) = sqrt(A) * sizeRatio / W
for (const row of rows) row.visual = Math.sqrt(row.opaque) * row.sizeRatio / row.width;
const visuals = rows.map((r) => r.visual);
const lo = Math.min(...visuals);
const hi = Math.max(...visuals);
console.log('pigs measured:', rows.length, ' (skipped:', manifest.pigs.length - rows.length + ')');
console.log('sizeRatio range:', rows[0].sizeRatio.toFixed(2), '..', rows[rows.length - 1].sizeRatio.toFixed(2));
console.log('视觉体量 spread:', ((hi / lo - 1) * 100).toFixed(1) + '%', ' (lo', lo.toFixed(1), 'hi', hi.toFixed(1), ')');
console.log('最宽:', JSON.stringify(rows[rows.length - 1]).slice(0, 120));
console.log('最窄:', JSON.stringify(rows[0]).slice(0, 120));

if (process.argv.includes('--write')) {
  const byId = new Map(rows.map((r) => [r.id, r.sizeRatio]));
  for (const pig of manifest.pigs) {
    if (byId.has(pig.id)) pig.sizeRatio = byId.get(pig.id);
  }
  manifest.sizeRatioBasis = { basis: 'sqrt(opaque area)', targetPx: 96, measuredAt: new Date().toISOString().slice(0, 10) };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('written: assets/manifest.json');
}
