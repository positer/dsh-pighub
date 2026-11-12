/**
 * 冻结素材库的构建脚本。
 *
 * 三个硬约束，缺一不可：
 *
 *   1. **逐图判定**：sources.json 里每张候选都必须有一条 judgements 记录；少一条、
 *      多一条都直接失败。这样「判定」不是嘴上说说，而是构建的前置条件。
 *   2. **每个版本冻结**：产物 assets/manifest.json 带 assetVersion 与每张图的
 *      sha256/bytes；抽猪池只认这张清单，而不是实时目录。上游后来换图不会影响已发版本。
 *   3. **定制切分**：切分参数（归一化裁切框 + 去白阈值）逐图存在清单里，由前端按同一套
 *      参数执行，所以同一份源图在任何机器上切出来都一样。
 *
 * 用法：
 *   node scripts/build-assets.mjs            # 校验并写入 assets/manifest.json
 *   node scripts/build-assets.mjs --vendor   # 额外把源图落到 assets/vendor/（默认不落）
 *
 * 为什么不默认把图存进仓库：上游没有数据许可（NOASSERTION）。默认只冻结「判定 + 参数 +
 * 源图指纹」，图仍由用户浏览器按指纹去取；需要完全离线分发时显式加 --vendor，
 * 那是把再分发决定交给调用者，而不是脚本替人做。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
const vendor = process.argv.includes('--vendor');

const sources = JSON.parse(readFileSync(join(assetsDir, 'sources.json'), 'utf8'));
const decisions = JSON.parse(readFileSync(join(assetsDir, 'judgements.json'), 'utf8'));

const candidates = Array.isArray(sources.candidates) ? sources.candidates : [];
const judged = Array.isArray(decisions.judgements) ? decisions.judgements : [];

/* ---- 校验：逐图判定必须一一对应 ---- */
const candidateIds = new Set(candidates.map((item) => item.id));
const judgedIds = new Set(judged.map((item) => item.id));
const missing = [...candidateIds].filter((id) => !judgedIds.has(id));
const extra = [...judgedIds].filter((id) => !candidateIds.has(id));
if (missing.length) {
  console.error('缺少判定：' + missing.join(', '));
  console.error('规则：候选池里每一张都必须有 kind/cut/note，否则不生成冻结库。');
  process.exit(1);
}
if (extra.length) {
  console.error('判定里有、候选池里没有：' + extra.join(', '));
  process.exit(1);
}
for (const decision of judged) {
  if (decision.kind !== 'live' && decision.kind !== 'dead') {
    console.error(decision.id + ' 的 kind 必须是 live 或 dead，实际：' + decision.kind);
    process.exit(1);
  }
  const trim = decision.cut && decision.cut.trim;
  if (!Array.isArray(trim) || trim.length !== 4 || trim.some((n) => typeof n !== 'number' || n < 0 || n > 1)) {
    console.error(decision.id + ' 的 cut.trim 必须是 4 个 0..1 的数字');
    process.exit(1);
  }
  if (typeof decision.vector !== 'boolean') {
    console.error(decision.id + ' 缺少 vector 判定（true=描摹成 SVG，false=保留位图）');
    process.exit(1);
  }
  if (!decision.note || String(decision.note).trim().length < 6) {
    console.error(decision.id + ' 缺少判定理由（note）');
    process.exit(1);
  }
}

/* ---- 取源图指纹（并可选地落到 vendor/） ---- */
if (vendor) mkdirSync(join(assetsDir, 'vendor'), { recursive: true });
const pigs = [];
for (const candidate of candidates) {
  const decision = judged.find((item) => item.id === candidate.id);
  const response = await fetch(candidate.url, { headers: { accept: 'image/*' } });
  if (!response.ok) {
    console.error(candidate.id + ' 取源图失败：HTTP ' + response.status);
    process.exit(1);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (vendor) {
    const ext = (candidate.filename.match(/\.[^.]+$/) || ['.bin'])[0];
    writeFileSync(join(assetsDir, 'vendor', candidate.id + ext), bytes);
  }
  pigs.push({
    id: candidate.id,
    title: candidate.title,
    kind: decision.kind,
    note: decision.note,
    cut: { trim: decision.cut.trim, white: decision.cut.white || 236, vector: decision.vector === true },
    source: { url: candidate.url, origin: candidate.source || 'pighub', sha256, bytes: bytes.length },
    vendored: vendor ? 'assets/vendor/' + candidate.id + (candidate.filename.match(/\.[^.]+$/) || ['.bin'])[0] : null,
  });
}

pigs.sort((a, b) => a.id.localeCompare(b.id));
const manifest = {
  assetVersion: decisions.assetVersion,
  frozenAt: new Date().toISOString(),
  policy: '冻结库：抽猪池只认这里；每张图带逐图判定（live/dead）、定制切分参数与源图 sha256。',
  counts: {
    total: pigs.length,
    live: pigs.filter((pig) => pig.kind === 'live').length,
    dead: pigs.filter((pig) => pig.kind === 'dead').length,
  },
  pigs,
};
writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('OK  assetVersion=' + manifest.assetVersion
  + '  total=' + manifest.counts.total
  + '  live=' + manifest.counts.live
  + '  dead=' + manifest.counts.dead
  + (vendor ? '  vendored' : '  (未落图)'));
for (const pig of pigs) {
  console.log('  ' + pig.id + '  ' + pig.kind + '  ' + pig.source.sha256.slice(0, 12) + '  ' + pig.source.bytes + 'B  ' + pig.title);
}