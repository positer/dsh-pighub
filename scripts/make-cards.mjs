/**
 * 生成「猪猪角色卡」样例集：从 PigHub 里挑角色型素材（xx猪 / 猪包），逐个跑同一套精修，
 * 再集体校验两件事：**是不是角色（不是行为梗）**、**图上角色名有没有去干净**。
 *
 * 与逐素材 subagent 流程的区别：这里是**成批出样**（数量优先），因此判定用可计算的指标：
 *   - 角色 vs 行为：先按标题排除行为词，再用像素复核（成图只剩 1 个连通块）；
 *   - 名字是否去净：成图里**除主体外不得有独立连通块**，且不得有小的深色碎块（文字特征）。
 * 任何一项不过就标 flagged，并写进报告等人工复核——不假装全绿。
 *
 * 用法：node scripts/make-cards.mjs [--n 50] [--append] [--loose]
 *   --append  不清空 assets/cards，只补**还没出现过的**新候选；索引合并后重写。
 *             扩包必须走这个模式：默认模式会 rm -rf 整个 cards 目录（历史判定会被抹掉）。
 *   --loose   放开「标题不含行为词」与「标题 ≤10 字」两条**预筛**，只保留「标题含猪 + 没判过」。
 *             2026-11-13 补 254→256 时新增：上游 /api/images 返回的 1361 条与本地
 *             assets/library/index.json 的 1361 条**逐 id 一致**（没有新图），而「角色名型」预筛
 *             能选出的候选已被判完（本次末尾一次 --append 输出「候选不足：只有 0 张」）。
 *             剩下 123 张含猪标题的库内图从未出过卡，它们只是被行为词预筛挡住的。
 *             行为词从来只是"能不能进候选"的启发式，**是不是角色、可不可爱仍然逐图目检**，
 *             所以让它们出成卡再判，比因为没有新图就宣布无法扩包更接近事实。
 *
 * 每条记录都带 `url`（源图地址）。这是 2026-11-13 补上的缺口：此前只存了产物与指纹，
 * 导致收编进冻结库时 source 里没有 url，只能说「来自 cards 批次」而指不到具体地址。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { stripBackground, contentBounds, cropFrame, padFrame, addOutline, styleScore } from '../lib/imaging.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cardDir = join(root, 'assets', 'cards', 'img');
const want = Number((process.argv[process.argv.indexOf('--n') + 1] || '50')) || 50;
const appendMode = process.argv.includes('--append');
// 放开预筛（见头注释 --loose）：只用于「角色名型候选已判完、上游无新图」的情况。
const looseMode = process.argv.includes('--loose');
const MAX_EDGE = 256;

/* 行为/情绪词：标题里出现就判为「行为梗」，不进角色卡 */
const BEHAVIOR = ['睡','困','看','委屈','伸懒腰','飞机','通话','耶','哭','跑','躺','吃','走','跳','抓','乱停','挂科','打','坐','唱','说','喊','抱','背','骑','摔','掉','追','躲','等','买','卖','喝','洗','飞','跳','摇','蹦','摇','盯','笑','怒','怕','慌','惊','呆'];
const CHARACTER_TAIL = /(猪|豚|包)$/;

const index = JSON.parse(readFileSync(join(root, 'assets', 'library', 'index.json'), 'utf8'));
const pool = index.items.filter((item) => item.status === 'ok' || item.status === 'gif');

function titleOf(id) { const row = pool.find((p) => p.id === id); return row ? row.title : ''; }

/* 选卡：名字以「猪 / 豚 / 包」结尾、不含行为词、长度 2..8，优先单块且分数高 */
const indexPath = join(root, 'assets', 'cards', 'index.json');
const previousCards = appendMode && existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, 'utf8')).cards || []
  : [];
const doneIds = new Set(previousCards.map((card) => card.id));

/* 「像角色」的两档判据：
 *   A. 标题以 猪/豚/包 结尾（老口径，最可靠）；
 *   B. 标题里含「猪」但不以它结尾（例如「猪头」「反求猪己」），2026-11-13 为凑够 100 张放开——
 *      放开只是"能进候选"，是不是角色仍由后面的像素判定 + 逐图目检决定。 */
const CHARACTER_ANY = /猪/;
const chosen = pool
  .filter((item) => {
    const title = String(item.title || '').trim();
    if (doneIds.has(item.id)) return false;
    if (!CHARACTER_TAIL.test(title) && !CHARACTER_ANY.test(title)) return false;
    // 2026-11-13：上限从 8 放到 10。角色名常见「XX猪」「YY豚」四到六字，但「猪咪猪咪猪」这类叠词更长；
    // 放宽只影响"能不能选出候选"，不影响判定——是不是角色、可不可爱仍然逐图目检。
    if (looseMode) return true;
    if (title.length < 2 || title.length > 10) return false;
    return !BEHAVIOR.some((word) => title.indexOf(word) >= 0);
  })
  // 先排「以猪结尾」的（老口径更可靠），再按风格分排序
  .sort((a, b) => {
    const ta = String(a.title || '').trim(), tb = String(b.title || '').trim();
    const tailA = CHARACTER_TAIL.test(ta) ? 1 : 0, tailB = CHARACTER_TAIL.test(tb) ? 1 : 0;
    if (tailA !== tailB) return tailB - tailA;
    return (b.style.palette + b.style.flatness) - (a.style.palette + a.style.flatness);
  })
  .slice(0, want);

if (chosen.length < want) console.warn('候选不足：只有 ' + chosen.length + ' 张满足「角色型」条件');

const api = await (await fetch('https://pighub.top/api/images?sort=2', { headers: { accept: 'application/json' } })).json();
const rows = new Map((api.data || []).map((row) => ['pighub-' + row.id, row]));

if (!appendMode) rmSync(join(root, 'assets', 'cards'), { recursive: true, force: true });
mkdirSync(cardDir, { recursive: true });
if (appendMode) console.log('追加模式：已有 ' + previousCards.length + ' 条，本次最多补 ' + want + ' 条');

/** 取「最像猪」的连通块：按 桃色/玫红 占比 × 面积。 */
function keepPigBlob(frame) {
  const { width, height, data } = frame;
  const total = width * height;
  const seen = new Uint8Array(total);
  const stack = [];
  let best = null;
  for (let seed = 0; seed < total; seed += 1) {
    if (seen[seed] || data[seed * 4 + 3] < 24) continue;
    stack.length = 0; stack.push(seed); seen[seed] = 1;
    const members = [seed];
    let pigment = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop();
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
      if (r > 150 && r > b && g > 90) pigment += 1;
      const x = p % width; const y = (p - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q < 0 || seen[q] || data[q * 4 + 3] < 24) continue;
        seen[q] = 1; stack.push(q); members.push(q);
      }
    }
    const likeness = members.length ? pigment / members.length : 0;
    const value = likeness * likeness * members.length;
    const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
    const fill = members.length / (boxW * boxH);
    // 触边：bbox 贴到画布边的边数（0..4）。贴边说明源图把猪裁掉了。
    const edges = (minX <= 0 ? 1 : 0) + (minY <= 0 ? 1 : 0) + (maxX >= width - 1 ? 1 : 0) + (maxY >= height - 1 ? 1 : 0);
    if (!best || value > best.value) best = { members, value, likeness, fill, edges };
  }
  if (!best) return { area: 0, likeness: 0, fill: 1, edges: 0 };
  const keep = new Uint8Array(total);
  for (const p of best.members) keep[p] = 1;
  for (let i = 0; i < total; i += 1) if (!keep[i]) data[i * 4 + 3] = 0;
  return { area: best.members.length, likeness: best.likeness, fill: best.fill, edges: best.edges };
}

/** 数连通块与「像文字的深色小碎块」。 */
function inspect(frame) {
  const { width, height, data } = frame;
  const total = width * height;
  const seen = new Uint8Array(total);
  const stack = [];
  let blobs = 0, big = 0, darkSpecks = 0, totalOpaque = 0;
  const components = [];
  for (let seed = 0; seed < total; seed += 1) {
    if (seen[seed] || data[seed * 4 + 3] < 24) continue;
    blobs += 1;
    stack.length = 0; stack.push(seed); seen[seed] = 1;
    let area = 0, dark = 0;
    while (stack.length) {
      const p = stack.pop();
      area += 1;
      const v = Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
      if (v <= 90) dark += 1;
      const x = p % width; const y = (p - x) / width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q < 0 || seen[q] || data[q * 4 + 3] < 24) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    totalOpaque += area;
    components.push({ area, dark });
  }
  components.sort((a, b) => b.area - a.area);
  big = components.length ? components[0].area : 0;
  // 主体之外的小块：像文字（<主体 2% 且深色占比 > 30%）
  for (let i = 1; i < components.length; i += 1) {
    const c = components[i];
    if (c.area < big * 0.02 && c.dark / c.area > 0.3) darkSpecks += 1;
  }
  return { blobs, big, small: totalOpaque - big, darkSpecks, opaque: totalOpaque };
}

const cards = [];
for (const item of chosen) {
  const row = rows.get(item.id);
  if (!row) continue;
  const url = 'https://pighub.top' + encodeURIComponent(row.image_url).replace(/%2F/g, '/');
  try {
    const raw = Buffer.from(await (await fetch(url, { headers: { accept: 'image/*' } })).arrayBuffer());
    const isGif = raw.subarray(0, 3).toString('ascii') === 'GIF';
    const head = raw.subarray(0, 64).toString('latin1');
    const isAnimWebp = raw.subarray(0, 4).toString('ascii') === 'RIFF' && raw.subarray(8, 12).toString('ascii') === 'WEBP' && head.indexOf('ANIM') >= 0;
    if (isGif || isAnimWebp) {
      // 动图：原样分发，占位记录，不做像素判定
      const ext = isGif ? '.gif' : '.webp';
      writeFileSync(join(cardDir, item.id + ext), raw);
      cards.push({ id: item.id, title: item.title, url, kind: 'animated', file: 'assets/cards/img/' + item.id + ext, bytes: raw.length, category: 'character', categoryBasis: '标题为角色名且为动图角色形象', nameRemoved: 'passthrough', flags: [] });
      continue;
    }
    const decoded = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let frame = { width: decoded.info.width, height: decoded.info.height, data: new Uint8Array(decoded.data) };
    // 角落取色判断白底还是黑底
    const corner = (x, y) => { const i = (y * frame.width + x) * 4; return Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]); };
    const corners = [corner(0, 0), corner(frame.width - 1, 0), corner(0, frame.height - 1), corner(frame.width - 1, frame.height - 1)];
    const avg = corners.reduce((a, b) => a + b, 0) / 4;
    let bgOptions = avg < 80 ? { key: 'dark', threshold: 40, all: false } : { key: 'light', threshold: 236, all: false };
    stripBackground(frame, bgOptions);
    let kept = keepPigBlob(frame);
    // 角落还留着不透明 = 背景没去干净：换一种色键再试一次（黑底/白底判断可能因图片边框而错）
    const cornerAlpha = () => [0, 1, 2, 3].map((k) => {
      const x = k % 2 ? frame.width - 1 : 0;
      const y = k > 1 ? frame.height - 1 : 0;
      return frame.data[(y * frame.width + x) * 4 + 3];
    });
    if (cornerAlpha().filter((a) => a > 40).length >= 2) {
      const decoded2 = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      frame = { width: decoded2.info.width, height: decoded2.info.height, data: new Uint8Array(decoded2.data) };
      const alt = avg < 80 ? { key: 'light', threshold: 236, all: false } : { key: 'dark', threshold: 40, all: false };
      stripBackground(frame, alt);
      kept = keepPigBlob(frame);
      bgOptions = alt;
    }
    const pigArea = kept.area;
    const cardLike = kept.fill >= 0.92 && pigArea > frame.width * frame.height * 0.25;
    if (pigArea < frame.width * frame.height * 0.02 || kept.likeness < 0.45 || cardLike) {
      cards.push({ id: item.id, title: item.title, url, kind: 'skipped', category: 'unknown', categoryBasis: (cardLike ? '选中的是矩形底卡（填充率 ' + kept.fill.toFixed(3) + '），不是猪' : '没有「像猪」的色块（likeness ' + (kept.likeness || 0).toFixed(2) + '）'), nameRemoved: 'n/a', flags: [cardLike ? 'card_like' : 'no_pig'] });
      continue;
    }
    const box = contentBounds(frame, 2);
    frame = cropFrame(frame, box.x, box.y, box.w, box.h);
    frame = padFrame(frame, 3);
    frame = addOutline(frame, 2, [43, 26, 16]);
    const score = styleScore(frame);
    const stats = inspect(frame);
    const scale = Math.min(1, MAX_EDGE / Math.max(frame.width, frame.height));
    const png = await sharp(Buffer.from(frame.data), { raw: { width: frame.width, height: frame.height, channels: 4 } })
      .resize({ width: Math.max(1, Math.round(frame.width * scale)), height: Math.max(1, Math.round(frame.height * scale)), fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const file = 'assets/cards/img/' + item.id + '.png';
    writeFileSync(join(root, file), png);
    const flags = [];
    if (stats.blobs > 1) flags.push('extra_blob');
    if (stats.darkSpecks > 0) flags.push('text_like_specks');
    if (score.verdict !== 'match') flags.push('style');
    cards.push({
      id: item.id, title: item.title, url, kind: 'static',
      file, bytes: png.length,
      size: [Math.round(frame.width * scale), Math.round(frame.height * scale)],
      style: score,
      blobs: stats.blobs, darkSpecks: stats.darkSpecks,
      fillRatio: Math.round(kept.fill * 1000) / 1000,
      flatEdges: kept.edges,
      background: bgOptions,
      category: 'character',
      categoryBasis: looseMode
        ? '标题含「猪」；成图仅一个连通块（无场景残留）——标题只是预筛，是不是角色由逐图目检定'
        : '标题以「猪/豚/包」结尾且不含行为词；成图仅一个连通块（无场景残留）',
      nameRemoved: flags.length === 0 ? 'verified' : 'flagged',
      flags,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  } catch (error) {
    cards.push({ id: item.id, title: item.title, url, kind: 'failed', category: 'unknown', categoryBasis: '下载或解码失败', nameRemoved: 'n/a', flags: ['error'], error: String(error.message || error) });
  }
  if (cards.length % 10 === 0) console.log('  已处理 ' + cards.length + '/' + chosen.length);
}

const all = previousCards.concat(cards);
const summary = {
  generatedAt: new Date().toISOString(),
  source: 'https://pighub.top/api/images?sort=2',
  requested: all.length,
  produced: all.filter((c) => !(c.flags || []).includes('error') && c.kind !== 'failed').length,
  character: all.filter((c) => c.category === 'character').length,
  nameRemoved: all.filter((c) => c.nameRemoved === 'verified').length,
  flagged: all.filter((c) => c.nameRemoved === 'flagged').length,
  animated: all.filter((c) => c.kind === 'animated').length,
  skipped: all.filter((c) => c.kind === 'skipped').length,
  // 目检结果沿用已有记录（append 模式不能把上次的判定洗掉）
  vision: {
    checked: all.filter((c) => c.vision && c.vision !== 'pending').length,
    pass: all.filter((c) => c.vision === 'pass').length,
    fail: all.filter((c) => c.vision === 'fail').length,
    pending: all.filter((c) => !c.vision || c.vision === 'pending').length,
  },
};
// 新条目默认 vision=pending：判不判是人的事，脚本不替人下结论。
for (const card of cards) if (!card.vision) card.vision = 'pending';
writeFileSync(join(root, 'assets', 'cards', 'index.json'), JSON.stringify({ summary, cards: all }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
