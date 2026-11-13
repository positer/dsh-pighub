/**
 * 把「角色卡样例集」里通过可爱闸门的候选项收进冻结素材库。
 *
 * 为什么是独立一步、而不是塞进 build-assets.mjs：
 *   build-assets.mjs 的工作是「从上游 URL 重新拉取 + 逐像素重做」；它对网络与源图有依赖，
 *   重跑会重新冻结全部素材。而扩包只需要把**已经在 cards 管线里做过同样处理**的产物收编，
 *   不该为了 17 张卡去重跑 14 张老素材（上游一变，老素材的指纹就跟着变）。
 *   所以这里是**只增不改**的第二条写入口：老素材原样保留，新素材追加。
 *
 * 三条硬约束（与 build-assets.mjs 同源）：
 *   1. 逐图判定：选进 assets/cards/selection.json 的每一张都必须有 mood + 理由；
 *   2. 可爱闸门：mood=reject 的一律不进包，只落进 manifest.moodRejected 留档；
 *   3. 可对账：贴图字节数与 sha256 当次重算，和 selection 里登记的指纹不符就失败。
 *
 * **只增不改（2026-11-13 回归修复）**：清单里**已有**的 id 一律原样保留，绝不重写 assets/img。
 *   曾经这里写成「先 filter(pig.adopted !== true) 把已收编的剔除，再从卡片原图整体重算」，
 *   于是第二次跑就把**已经补全/加工过的贴图覆盖回残缺版**（实测：把 231 个既有文件全部重写，
 *   其中 659/865/868/379/255/341 六只补全过的被打回原形，1087/27/751/426 的 incomplete 记录也一起丢了）。
 *   现在的口径是：老条目连同 complete/incomplete/sizeRatio/mood 这些加工记录一起留在原地，
 *   只有清单里**没有**的 id 才落盘；目标文件已存在时同样跳过（id 有两套命名：pig-N 与 pighub-N）。
 *
 * 用法：node scripts/adopt-cards.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const assetsDir = join(root, 'assets');
const imageDir = join(assetsDir, 'img');
const dryRun = process.argv.includes('--dry-run');

const manifestPath = join(assetsDir, 'manifest.json');
const selectionPath = join(assetsDir, 'cards', 'selection.json');
const judgementsPath = join(assetsDir, 'judgements.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const selection = JSON.parse(readFileSync(selectionPath, 'utf8'));
const judgements = JSON.parse(readFileSync(judgementsPath, 'utf8'));
// 动画卡的「真实不透明像素数」：纯 Node 量不了 GIF 的 alpha，由 scripts/gif-alpha.py 量一次写在这里。
// 没有这份读数就留空，size-ratios.mjs 会退回「整块画布算不透明」的估算——对长条画布误差很大。
const gifStatsPath = join(assetsDir, 'work', 'gif-alpha-report.json');
const gifStats = existsSync(gifStatsPath) ? JSON.parse(readFileSync(gifStatsPath, 'utf8')) : {};

const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex');
const fail = (message) => { console.error('adopt-cards: ' + message); process.exit(1); };

/* ---- 1. 现有清单先自检：老素材的文件必须还在、指纹必须对得上 ---- */
// 清单是**只增不改**的：已收编的条目（adopted:true）也留在这里，连同 complete/incomplete/sizeRatio
// 一起原样保留。上一次的回归就是在这里把它们剔除，随后从卡片原图重写贴图，把加工过的素材打回原形。
const previous = (manifest.pigs || []);
/** 老素材已经占用的 id：卡片里可能也有同一只（例如圆猪），不能再收编一份——否则清单出现重复 id，
 *  而且会拿卡片原图覆盖掉已经加工好的贴图。 */
const takenIds = new Set(previous.map((pig) => pig.id));
/** 清单里的 id 有两套命名（pig-N 与 pighub-N，都来自上游 id N），跨命名空间也必须算「已占用」，
 *  否则同一只猪会以两个 id 进库、贴图被收第二份。standard-pig 这种没有编号的按原字符串算。 */
const bareOf = (id) => String(id).replace(/^(pighub|pig)-/, '');
const takenBare = new Set(previous.map((pig) => bareOf(pig.id)));
for (const pig of previous) {
  const file = join(root, String(pig.file || ''));
  if (!existsSync(file)) fail('清单里的 ' + pig.id + ' 找不到贴图：' + pig.file);
  const actual = sha256Of(readFileSync(file));
  if (pig.sha256 && actual !== pig.sha256) fail(pig.id + ' 的贴图指纹与清单不符（' + actual.slice(0, 12) + ' vs ' + pig.sha256.slice(0, 12) + '）');
}

/* ---- 2. 逐条校验 selection ---- */
const cards = Array.isArray(selection.cards) ? selection.cards : [];
if (!cards.length) fail('assets/cards/selection.json 里没有候选');
const seen = new Set();
for (const card of cards) {
  if (!card || typeof card.id !== 'string') fail('候选缺少 id');
  if (seen.has(card.id)) fail('候选 id 重复：' + card.id);
  seen.add(card.id);
  if (card.mood !== 'cute' && card.mood !== 'reject') fail(card.id + ' 的 mood 必须是 cute/reject');
  if (!card.moodReason || String(card.moodReason).trim().length < 6) fail(card.id + ' 缺少可爱闸门的判定理由');
  if (card.kind !== 'live' && card.kind !== 'dead') fail(card.id + ' 的 kind 必须是 live/dead');
  if (typeof card.vector !== 'boolean') fail(card.id + ' 缺少 vector 判定');
  const source = join(root, String(card.sourceFile || ''));
  if (!existsSync(source)) fail(card.id + ' 的卡片产物不存在：' + card.sourceFile);
  const bytes = readFileSync(source);
  const actual = sha256Of(bytes);
  if (card.sha256 && actual !== card.sha256) fail(card.id + ' 的卡片指纹与 index.json 不符（' + actual.slice(0, 12) + '）');
  if (typeof card.bytes === 'number' && bytes.length !== card.bytes) fail(card.id + ' 的字节数与登记不符（' + bytes.length + ' vs ' + card.bytes + '）');
}

/* ---- 3. 收编 cute、留档 reject ---- */
const adopted = [];
const rejectedCards = [];
const skipped = [];
for (const card of cards) {
  if (card.mood === 'reject') {
    rejectedCards.push({
      id: card.id,
      title: card.title,
      mood: 'reject',
      reason: card.moodReason,
      source: { via: 'cards', file: card.sourceFile },
    });
    continue;
  }
  if (takenIds.has(card.id) || takenBare.has(bareOf(card.id))) {
    skipped.push({ id: card.id, title: card.title, reason: '老素材里已有同一只（同 id 或同上游编号），不重复收编' });
    continue;
  }
  takenIds.add(card.id);
  takenBare.add(bareOf(card.id));
  // 动画卡必须先在 scripts/gif-alpha.py 里加工过（去白底 + 裁到内容框 + 量出不透明面积）。
  // 没过这一步就收编，会在草地猪圈上显示成一块白方框，sizeRatio 也只能按整块画布估。
  if (card.animated === true && !gifStats[card.id]) {
    fail(card.id + ' 是动画卡，但没有 gif-alpha 读数：先跑 python scripts/gif-alpha.py ' + card.id);
  }
  const source = join(root, String(card.sourceFile));
  const srcBytes = readFileSync(source);
  // 扩展名跟着卡片产物走：静态卡是 .png 原样收编；动画卡是 .gif，且它通常已经由
  // scripts/gif-alpha.py 去白底 + 裁到内容框后写进了 assets/img（见该脚本头注释）。
  const ext = (String(card.sourceFile).match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
  const fileName = card.id + ext;
  const target = join(imageDir, fileName);
  const animated = ext !== '.png';
  // 第二道闸：目标贴图已经在盘上就绝不覆盖。对新 id 来说这等于「采用上游加工步骤产出的最终文件」；
  // 对已有素材来说（takenIds 已在上一步挡掉）则是安全网——加工过的像素无法从卡片里恢复。
  const prebuilt = existsSync(target);
  if (!prebuilt && !dryRun) copyFileSync(source, target);
  const bytes = prebuilt ? readFileSync(target) : srcBytes;
  const dimensions = readImageSize(bytes, ext);
  adopted.push({
    id: card.id,
    title: card.title,
    kind: card.kind,
    note: card.note || '',
    vector: card.vector === true,
    animated,
    file: 'assets/img/' + fileName,
    bytes: bytes.length,
    sha256: sha256Of(bytes),
    size: dimensions,
    source: {
      group: 'pighub-online',
      via: 'cards',
      file: card.sourceFile,
      sha256: sha256Of(bytes),
      // 卡片管线自 2026-11-13 起记录源图 URL；有就带出来，没有就留空（不构造假地址）。
      ...(card.url ? { url: card.url } : {}),
    },
    mood: 'cute',
    moodReason: card.moodReason,
    // 判定是两轴：vision（是不是一只猪角色）与 mood（可不可爱）。只落 moodReason 会让
    // 「为什么判它是猪」停在 index.json 里，清单本身对不上账。老条目没有这个字段，原样不动。
    ...(card.visionReason ? { visionReason: card.visionReason } : {}),
    adopted: true,
  });
}

/* ---- 4. 老素材补 mood：判定表是唯一来源 ---- */
const byId = new Map(judgements.judgements.map((item) => [item.id, item]));
for (const pig of previous) {
  // 项目自带的标准猪（builtin，不是上游素材）没有 judgements 记录，跳过
  if (pig.standard === true) continue;
  // 卡片收编的猪判定在 cards 管线（selection.json），judgements.json 里没有它们，也无须回填
  if (pig.adopted === true) continue;
  const decision = byId.get(pig.id);
  if (!decision) fail(pig.id + ' 在 judgements.json 里没有判定');
  if (decision.mood !== 'cute' && decision.mood !== 'reject') fail(pig.id + ' 的判定缺少 mood');
  pig.mood = decision.mood;
  pig.moodReason = decision.moodReason || '';
}

const pigs = previous.concat(adopted).sort((a, b) => String(a.id).localeCompare(String(b.id)));

/* ---- 5. 动画卡补 sizeOpaque：有了真值，size-ratios 就不用把整块画布当不透明 ---- */
let sizedOpaque = 0;
for (const pig of pigs) {
  const stat = gifStats[pig.id];
  if (pig.animated !== true || pig.sizeOpaque != null) continue;
  if (!stat || !Number.isFinite(stat.opaqueMedian) || stat.opaqueMedian <= 0) continue;
  pig.sizeOpaque = stat.opaqueMedian;
  sizedOpaque += 1;
}
const next = {
  ...manifest,
  frozenAt: dryRun ? manifest.frozenAt : new Date().toISOString(),
  assetVersion: dryRun ? manifest.assetVersion : '2026.11.12-card',
  moodGate: {
    rule: '只收可爱；血腥（獠牙撕咬/伤口/血）、身体恐怖（一具身体多张脸）、惊悚造型一律 reject。',
    decidedAt: '2026-11-12',
    appliedAt: dryRun ? null : new Date().toISOString(),
  },
  moodRejected: rejectedCards,
  counts: {
    total: pigs.length,
    live: pigs.filter((pig) => pig.kind === 'live').length,
    dead: pigs.filter((pig) => pig.kind !== 'live').length,
    vector: pigs.filter((pig) => pig.vector).length,
    // 语义是「库里有几只来自卡片收编」，不是「这一跑新收了几只」；本次新增另有一行日志。
    adopted: pigs.filter((pig) => pig.adopted === true).length,
  },
  pigs,
};

if (!dryRun) writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf8');

console.log('收编 ' + adopted.length + ' 张，拒绝 ' + rejectedCards.length + ' 张，跳过（已存在）' + skipped.length + ' 张，冻结库合计 ' + pigs.length + ' 张（活 ' + next.counts.live + ' / 死 ' + next.counts.dead + ' / 矢量 ' + next.counts.vector + '）');
if (sizedOpaque) console.log('补 sizeOpaque（动画卡真实不透明像素）' + sizedOpaque + ' 张');
if (skipped.length) console.log('已存在的 id：' + skipped.map((s) => s.id).join('、'));
if (rejectedCards.length) console.log('可爱闸门拒收：' + rejectedCards.map((item) => item.id + ' ' + item.title).join('、'));
if (dryRun) console.log('（--dry-run：只报告，没写盘）');

/** 读贴图头里的宽高（PNG 的 IHDR / GIF 的逻辑屏幕）。避免为几张图引入 sharp 依赖。 */
function readImageSize(buffer, ext) {
  if (ext === '.png') {
    if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return { width: 0, height: 0 };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (ext === '.gif') {
    if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') return { width: 0, height: 0 };
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  return { width: 0, height: 0 };
}
