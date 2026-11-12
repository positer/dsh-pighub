/**
 * 从全库分流结果里挑「像猪的种类」的候选，供逐素材 subagent 处理。
 *
 * 分流（refine-library.mjs）只负责排序，不负责定稿；这里再把门槛收紧：
 *   - 风格通过（palette/flatness 达闸门）；
 *   - 连通块数少（背景不碎、不是场景拼贴）；
 *   - 已排除重复（与已进包的猪做尺寸/标题去重）。
 *
 * 用法：node scripts/pick-candidates.mjs [--n 8] [--json]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const want = Number(args[args.indexOf('--n') + 1] || '8') || 8;
const asJson = args.includes('--json');

const index = JSON.parse(readFileSync(join(here, '..', 'assets', 'library', 'index.json'), 'utf8'));
const manifestPath = join(here, '..', 'assets', 'manifest.json');
const bundled = new Set(JSON.parse(readFileSync(manifestPath, 'utf8')).pigs.map((pig) => pig.id.replace('pig-', 'pighub-')));

const rows = index.items
  .filter((item) => item.status === 'ok')
  .filter((item) => !bundled.has(item.id))
  .map((item) => ({
    id: item.id,
    title: item.title,
    palette: item.style.palette,
    flatness: item.style.flatness,
    blobs: item.blobs,
    size: item.size,
    bytes: item.bytes,
    // 排序分：像猪度为主，块数越少（越像一个整体）加分，极大/极小图扣分
    score: item.style.palette * 2 + item.style.flatness + (item.blobs <= 3 ? 0.3 : 0) - Math.abs(Math.log2((item.size?.[0] || 256) / 300)) * 0.1,
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, want);

if (asJson) { console.log(JSON.stringify(rows, null, 2)); }
else {
  console.log('候选（按像猪度排序，仅供参考，定稿仍需逐素材 subagent）：');
  for (const row of rows) {
    console.log('  ' + row.id + '  ' + (row.title || '').slice(0, 18) + '  palette=' + row.palette + ' flat=' + row.flatness + ' blobs=' + row.blobs + ' ' + (row.size || []).join('x'));
  }
  console.log('\n共 ' + index.items.filter((i) => i.status === 'ok').length + ' 张通过初筛，包内已有 ' + bundled.size + ' 张。');
}
