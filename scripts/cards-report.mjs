/**
 * 从 assets/cards/index.json 重新生成 assets/cards/README.md。
 * 判定表始终与索引同源：手写表格一定会漂（上一版就停在 50 张），所以这里改成生成。
 *
 * 用法：node scripts/cards-report.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const idx = JSON.parse(readFileSync(join(root, 'assets', 'cards', 'index.json'), 'utf8'));
const cards = idx.cards || [];
const s = idx.summary || {};

const pass = cards.filter((c) => c.vision === 'pass');
const fail = cards.filter((c) => c.vision === 'fail');
const cute = cards.filter((c) => c.mood === 'cute');
const pending = cards.filter((c) => !c.vision || c.vision === 'pending');
const byKind = (kind) => cards.filter((c) => c.kind === kind).length;

/** 失败原因的粗分类：从 visionReason 里取第一段 */
function bucket(reason) {
  const text = String(reason || '');
  if (/文字|字样|标语|符号/.test(text)) return '图上文字/符号没去净';
  if (/武器|刀|枪|剑|炸弹|镰刀|锯|弓/.test(text)) return '含武器/危险道具';
  if (/多主体|多配件|两只|三只|围绕|叠加/.test(text)) return '多主体或多配件';
  if (/场景|背景|游戏界面|夜晚/.test(text)) return '场景而非角色';
  if (/猎奇|比例|人形|血|怪物/.test(text)) return '猎奇 / 比例异常 / 血腥';
  if (/残肢|纸张|底座|设备/.test(text)) return '道具或底座留在图上';
  return '其他';
}

const buckets = new Map();
for (const c of fail) {
  const key = bucket(c.visionReason);
  buckets.set(key, (buckets.get(key) || 0) + 1);
}

const lines = [];
lines.push('# 猪猪角色卡样例集');
lines.push('');
lines.push('生成时间：' + (s.generatedAt || '—') + '　来源：' + (s.source || 'https://pighub.top/api/images?sort=2'));
lines.push('');
lines.push('> 本文件由 `node scripts/cards-report.mjs` 从 `index.json` 生成，不要手改。');
lines.push('');
lines.push('## 汇总');
lines.push('');
lines.push('| 项 | 数 |');
lines.push('|---|---|');
lines.push('| 候选（累计处理） | ' + cards.length + ' |');
lines.push('| 静态卡 | ' + byKind('static') + ' |');
lines.push('| 动图（原样分发） | ' + byKind('animated') + ' |');
lines.push('| 生成时排除（底卡/无猪/失败） | ' + (byKind('skipped') + byKind('failed')) + ' |');
lines.push('| **目检通过（角色卡）** | **' + pass.length + '** |');
lines.push('| 其中可爱闸门判为 cute | **' + cute.length + '** |');
lines.push('| 目检不合格 | ' + fail.length + ' |');
lines.push('| 待检 | ' + pending.length + ' |');
lines.push('');
lines.push('## 不合格的分类');
lines.push('');
lines.push('| 原因 | 张数 |');
lines.push('|---|---|');
for (const [key, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) lines.push('| ' + key + ' | ' + n + ' |');
lines.push('');
lines.push('## 逐张判定（通过的部分）');
lines.push('');
lines.push('| # | 角色 | 判定 | 理由 |');
lines.push('|---|---|---|---|');
pass.forEach((c, i) => {
  lines.push('| ' + (i + 1) + ' | ' + c.title + '（' + c.id + '） | ✅ | ' + (c.visionReason || '') + ' |');
});
lines.push('');
lines.push('## 不合格清单（逐条可查）');
lines.push('');
lines.push('| # | 角色 | 原因 |');
lines.push('|---|---|---|');
fail.forEach((c, i) => {
  lines.push('| ' + (i + 1) + ' | ' + c.title + '（' + c.id + '） | ' + (c.visionReason || '') + ' |');
});
lines.push('');
lines.push('## 口径');
lines.push('');
lines.push('- **是角色**：单只猪形象（可以带一体化的造型，如西瓜猪、狮子猪、摩羯猪）；行为梗、场景截图、多主体、以人形为主体的不算。');
lines.push('- **名字去净**：图上不得残留角色名/台词/品牌字；气泡、屏幕、卷轴里的文字同样算残留。');
lines.push('- **可爱闸门**：血腥、獠牙撕咬、伤口、武器、猎奇造型（人形肌肉、血盆大口、油炸化）一律不进包，理由逐条写在这里。');
lines.push('- 判据只看像素与标题无关：叫「怪猪」的照收，叫「可爱猪」的照样要过闸门。');
writeFileSync(join(root, 'assets', 'cards', 'README.md'), lines.join('\n') + '\n', 'utf8');
console.log('README.md 已生成：pass=' + pass.length + ' cute=' + cute.length + ' fail=' + fail.length + ' pending=' + pending.length);
