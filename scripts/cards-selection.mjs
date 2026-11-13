/**
 * 从 assets/cards/index.json 生成/更新 assets/cards/selection.json：
 * 所有 vision=pass 且 mood=cute 的**静态卡与动画卡**都进收编名单；此前的 reject 条目原样保留（留档）。
 * 幂等：重复运行不会重复追加。
 *
 * 2026-11-13 变更（扩到 256 只时）：
 *   1. 动画卡也收（原先只收 kind=static）。动画卡进包要先去白底 + 裁到内容框，
 *      这一步在 scripts/gif-alpha.py，不在本脚本里。
 *   2. 明确不收的卡见 DROPPED：理由写在这里，重跑不会把这个决定洗掉。
 * 依据：cute 258 张里 static 243 / animated 9 / skipped 4 / failed 2；
 *      skipped 与 failed 那 6 张没有产物文件（file=null），本就收不了。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * 明确不收的 cute 卡（人工决定 + 实测依据，不是随手挑的）。
 * 剔除它们的目的是「同一套变体只留一张」与「画面里别的东西不能收」，
 * 而不是判它们不可爱——它们的 mood 判定原样留在 index.json 里。
 */
const DROPPED = {
  'pighub-808': '与 pighub-813 同一底图（首帧 128x128 灰度均值差 0.51），813 分辨率更高（512 vs 358），同一套只留一张',
  'pighub-809': '与 pighub-813 同一底图（首帧均值差 2.83），画布最小（165×165），同一套只留一张',
  'pighub-818': '动画第 86 帧是整幅核爆蘑菇云、画面里已经没有猪（判定当时只看了第 0 帧），不上桌面',
  // 库里已经有这只（清单里叫 pig-1131，上游 id 同是 1131，贴图 sha256 与卡片产物逐字节相同）。
  // 收编名单里再放一份会让清单出现同一只猪的两个 id，所以这里明确不收。
  'pighub-1131': '库里已有同一只（pig-1131，sha256 ce45538a… 与卡片产物一致），不重复收编',
  // 2026-11-13 决定：不补全、也不进池，直接剔除（它在库里时已标 incomplete 不进抽池，但保留可渲染）。
  // 理由与被删贴图的备份见 archive/pool-to-256.md；judgement 仍留在 index.json 里没改。
  'pighub-997': '右侧被画布直切（内缩 2px 猪身色 0.938），头部缺一块；按「不完整的一律补全或剔除」剔除',
  // 2026-11-13 补 254→256 时补上：426 早已在 manifest.excluded 里（有头无身、换头法判不可补），
  // 但它的 mood=cute 判定一直留在 index.json（「剔除不等于改判」），于是 selection 里留着它、
  // 抽池里没有它 —— smoke 1.55「判为 cute 却没进抽池」因此**红**。剔除决定必须落在常量里，
  // 与 997 同口径：判定不改，只不进收编名单。
  'pighub-426': '有头无身，且原图脸上带深蓝布景毯与一只猪蹄；换头法清理后仍剩 2020 个暗像素、3 倍可见灰带与锯齿，判不可补（manifest.excluded 同一条理由）',
  // 2026-11-13 补 254→256 时新增：与库里 pighub-772 同一底图的变体。
  // 128×128 灰度均值差 4.73，而同批次近的一对是 17.79（scripts/_pool-254-to-256-diff.mjs 实测），
  // 属于「同一套只留一张」；772 已在池里，所以这一张只留档。
  'pighub-766': '与库里 pighub-772 同一底图（128×128 灰度均值差 4.73，次近 17.79），同一套只留一张',
};

const idx = JSON.parse(readFileSync('assets/cards/index.json', 'utf8'));
const path = 'assets/cards/selection.json';
const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { cards: [] };
const rejects = (previous.cards || []).filter((c) => c.mood === 'reject');
const cute = idx.cards.filter((c) => c.vision === 'pass' && c.mood === 'cute'
  && (c.kind === 'static' || c.kind === 'animated') && !DROPPED[c.id]);

const cards = cute.map((c) => {
  const animated = c.kind === 'animated';
  return {
    id: c.id,
    title: c.title,
    kind: 'live',
    vector: false,
    animated,
    mood: 'cute',
    moodReason: c.moodReason || c.visionReason || '目检通过：单只猪角色、无文字、无血腥',
    // 两轴判定的第一轴也要跟着走：manifest 的新条目要能对账「为什么判它是猪」，
    // 只留 moodReason 会把 visionReason 丢在 index.json 里（2026-11-13 补 254→256 时补上的缺口）。
    ...(c.visionReason ? { visionReason: c.visionReason } : {}),
    note: animated
      ? '角色卡样例集产出（动画 GIF：已去白底、裁到动画全程的内容框），首次进包按活猪处理。'
      : '角色卡样例集产出（已去底/裁到猪身/去角色名），首次进包按活猪处理。',
    sourceFile: c.file,
    url: c.url,
    // 动画卡的 index 条目没有 sha256 / size（make-cards 只给静态卡算），这里不编造：
    // 缺就留空，由 adopt-cards 按落盘后的实际文件登记。
    bytes: c.bytes,
    ...(Array.isArray(c.size) ? { size: { width: c.size[0], height: c.size[1] } } : {}),
    ...(c.sha256 ? { sha256: c.sha256 } : {}),
  };
});

const out = {
  note: '角色卡样例集里通过「可爱闸门」的候选项。adopt 会把这些图从 assets/cards/img 复制进 assets/img 并写进冻结清单；reject 只留档不进包。来源与证据：assets/cards/index.json（同一批产出，同一套逐图校验）。',
  cards: cards.concat(rejects),
};
writeFileSync(path, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('selection: cute=' + cards.length + ' reject=' + rejects.length + ' total=' + out.cards.length);
