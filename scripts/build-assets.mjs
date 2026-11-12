/**
 * 冻结素材库的构建脚本 —— **素材在这里就被处理成最终文件**，运行时不再做任何图像计算。
 *
 * 流程（每张图）：
 *   1. 取源图（构建期一次性下载）；
 *   2. 按判定里的裁切框裁剪（定制切分）；
 *   3. 全域去白：与四边相连的白一律去掉；被围住的白只在「内容稀疏」（气泡/清单）时保留；
 *   4. 踩到猪身：按剩余内容的外接框再裁一次；
 *   5. 判定 vector=true 的描摹成 SVG，其余存 PNG；
 *   6. 写进 assets/img/，并把文件名、sha256、字节数、来源署名记进 assets/manifest.json。
 *
 * 三条硬约束：
 *   - **逐图判定**：候选池里每张都必须有 kind / vector / 裁切 / 阈值 / 理由，缺一条就失败；
 *   - **每版冻结**：产物带 assetVersion 与每张贴图指纹，运行时只认这张清单；
 *   - **保留署名、不链接素材库**：清单里记来源与许可说明，但运行时不再访问上游。
 *
 * 用法：node scripts/build-assets.mjs [--vendor]
 *   --vendor 额外把**原始源图**留一份到 assets/source/（默认不留，产物已经够用）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { refineWhite, stripAllWhite, contentBounds, cropFrame, vectorise, TRACE_MAX_EDGE, restoreRects, eraseRects, addOutline, styleScore } from '../lib/imaging.js';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
const imageDir = join(assetsDir, 'img');
const keepSources = process.argv.includes('--vendor');

const sources = JSON.parse(readFileSync(join(assetsDir, 'sources.json'), 'utf8'));
const decisions = JSON.parse(readFileSync(join(assetsDir, 'judgements.json'), 'utf8'));
const candidates = Array.isArray(sources.candidates) ? sources.candidates : [];
const judged = Array.isArray(decisions.judgements) ? decisions.judgements : [];

/* ---- 校验：逐图判定必须一一对应 ---- */
const candidateIds = new Set(candidates.map((item) => item.id));
const judgedIds = new Set(judged.map((item) => item.id));
const missing = [...candidateIds].filter((id) => !judgedIds.has(id));
const extra = [...judgedIds].filter((id) => !candidateIds.has(id));
if (missing.length) { console.error('缺少判定：' + missing.join(', ')); process.exit(1); }
if (extra.length) { console.error('判定里有、候选池里没有：' + extra.join(', ')); process.exit(1); }
for (const decision of judged) {
  if (decision.kind !== 'live' && decision.kind !== 'dead') { console.error(decision.id + ' 的 kind 必须是 live/dead'); process.exit(1); }
  if (typeof decision.vector !== 'boolean') { console.error(decision.id + ' 缺少 vector 判定'); process.exit(1); }
  const trim = decision.cut && decision.cut.trim;
  if (!Array.isArray(trim) || trim.length !== 4 || trim.some((n) => typeof n !== 'number' || n < 0 || n > 1)) {
    console.error(decision.id + ' 的 cut.trim 必须是 4 个 0..1 的数字');
    process.exit(1);
  }
  if (!decision.note || String(decision.note).trim().length < 6) { console.error(decision.id + ' 缺少判定理由'); process.exit(1); }
}

rmSync(imageDir, { recursive: true, force: true });
mkdirSync(imageDir, { recursive: true });
if (keepSources) mkdirSync(join(assetsDir, 'source'), { recursive: true });

const pigs = [];
const rejected = [];
for (const candidate of candidates) {
  const decision = judged.find((item) => item.id === candidate.id);
  // 只接受 jpeg/png：jimp 不认 webp，而部分 CDN 会按 Accept 协商成 webp。
  const response = await fetch(candidate.url, { headers: { accept: 'image/jpeg,image/png' } });
  if (!response.ok) { console.error(candidate.id + ' 取源图失败：HTTP ' + response.status); process.exit(1); }
  const raw = Buffer.from(await response.arrayBuffer());
  const sourceSha = createHash('sha256').update(raw).digest('hex');
  if (keepSources) writeFileSync(join(assetsDir, 'source', candidate.id + guessExt(candidate.filename, 'jpg')), raw);

  // GIF 动图：原样随包分发。动画是内容本身，去白/裁切/描摹都会把它冻成一张静态图。
  const head = raw.subarray(0, 64).toString('latin1');
  const isGif = raw.subarray(0, 3).toString('ascii') === 'GIF';
  const isAnimatedWebp = raw.subarray(0, 4).toString('ascii') === 'RIFF'
    && raw.subarray(8, 12).toString('ascii') === 'WEBP'
    && head.indexOf('ANIM') >= 0;
  if (isGif || isAnimatedWebp) {
    // 动图：原样随包分发。**不做 trim/去白/描摹**——那会把动画冻成一帧；
    // 风格分只评第 0 帧，用来拦掉画风不符的动图。
    // 动图原样分发，但**风格仍要评**：只看第一帧的像素分布，避免把别的画风混进来。
    let gifStyle = { verdict: 'match', palette: null, flatness: null, note: '未评分' };
    try {
      const first = await sharp(raw, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      gifStyle = styleScore({ width: first.info.width, height: first.info.height, data: first.data });
    } catch { /* 解不出第一帧就放行，但记账 */ }
    const gifOverride = decision.styleOverride === true;
    if (gifStyle.verdict === 'reject' && !gifOverride) {
      rejected.push({ id: candidate.id, title: candidate.title, style: gifStyle, animated: true, reason: 'animated_passthrough_needs_per_frame_alpha' });
      console.log('  SKIP ' + candidate.id + ' 风格校验未通过（GIF 首帧 palette=' + gifStyle.palette + '）');
      continue;
    }
    const ext = isGif ? '.gif' : '.webp';
    const file = candidate.id + ext;
    writeFileSync(join(imageDir, file), raw);
    pigs.push({
      id: candidate.id,
      title: candidate.title,
      kind: decision.kind,
      note: decision.note,
      vector: false,
      animated: true,
      file: 'assets/img/' + file,
      bytes: raw.length,
      sha256: sourceSha,
      size: { width: 0, height: 0 },
      source: { url: candidate.url, group: candidate.source || 'pighub-online', sha256: sourceSha },
      cut: { trim: [0, 0, 1, 1], white: 0 },
      style: gifStyle,
    });
    continue;
  }

  // 解码成 RGBA（sharp 支持 jpeg/png/webp —— 上游有把 webp 标成 image/jpeg 的情况）
  const decoded = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frame = { width: decoded.info.width, height: decoded.info.height, data: decoded.data };

  // 1) 定制切分：work 里若有 trim（原图归一化坐标）就用它，否则用判定里的 cut.trim
  const workPath = join(assetsDir, 'work', decision.id + '.json');
  const work = existsSync(workPath) ? JSON.parse(readFileSync(workPath, 'utf8')) : null;
  const trim = work && Array.isArray(work.trim) ? work.trim : decision.cut.trim;
  const trimmed = cropFrame(
    frame,
    Math.max(0, Math.round(frame.width * trim[0])),
    Math.max(0, Math.round(frame.height * trim[1])),
    Math.max(1, Math.round(frame.width * trim[2])),
    Math.max(1, Math.round(frame.height * trim[3])),
  );

  // 2) 逐素材专项处理。约定：work 里的 trim / keep / erase 全部是**原图归一化坐标**
  //    （和逐图判定一样，人以整张图为参照给框），这里统一映射到工作帧。
  const trimRect = trim;
  // work 里的框是**原图坐标系**，映射成裁后帧坐标
  const toFrame = (rect) => [
    (rect[0] - trimRect[0]) / trimRect[2],
    (rect[1] - trimRect[1]) / trimRect[3],
    rect[2] / trimRect[2],
    rect[3] / trimRect[3],
  ];
  const before = { width: trimmed.width, height: trimmed.height, data: Uint8Array.from(trimmed.data) };
  if (work && work.whiteAll) stripAllWhite(trimmed, (work.white || decision.cut.white) || 236);
  else refineWhite(trimmed, (work && work.white) || decision.cut.white || 236);
  if (work) {
    if (Array.isArray(work.keep) && work.keep.length) restoreRects(trimmed, before, work.keep.map(toFrame));
    if (Array.isArray(work.erase) && work.erase.length) eraseRects(trimmed, work.erase.map(toFrame));
  }

  // 3) 踩到猪身（按内容外接框再裁一次）。pad 要给描边留位置，否则紧框会把描边环裁掉。
  const outlineWidth = work && work.outline && work.outline.width > 0 ? work.outline.width : 0;
  const box = contentBounds(trimmed, outlineWidth + 1);
  let cropped = cropFrame(trimmed, box.x, box.y, box.w, box.h);
  if (work && work.outline && work.outline.width > 0) {
    cropped = addOutline(cropped, work.outline.width, work.outline.color || [43, 26, 16]);
  }

  let payload = null;
  const ext = decision.vector ? 'svg' : 'png';
  const file = decision.id + '.' + ext;
  const target = join(imageDir, file);

  if (decision.vector) {
    // 描摹前先缩到最长边 ≤ TRACE_MAX_EDGE：矢量结果不依赖源分辨率，但描摹耗时与像素数成正比。
    const scale = Math.min(1, TRACE_MAX_EDGE / Math.max(cropped.width, cropped.height));
    const smallW = Math.max(1, Math.round(cropped.width * scale));
    const smallH = Math.max(1, Math.round(cropped.height * scale));
    const small = scale === 1 ? cropped : resizeNearest(cropped, smallW, smallH);
    const svg = vectorise(small);
    if (!svg) { console.error(candidate.id + ' 描摹失败（判定为 vector 却没有可描内容）'); process.exit(1); }
    payload = svg;
  } else {
    // 显示尺寸远小于原始像素：最长边压到 ≤ 512，包体从数 MB 降到百 KB 量级。
    const limit = 512;
    const pipeline = sharp(Buffer.from(cropped.data), { raw: { width: cropped.width, height: cropped.height, channels: 4 } });
    if (Math.max(cropped.width, cropped.height) > limit) pipeline.resize({ width: cropped.width >= cropped.height ? limit : null, height: cropped.height > cropped.width ? limit : null });
    payload = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  }
  // 风格化校验：只看像素分布，标题里有没有「猪」字不参与判断。
  const style = styleScore(cropped);
  const override = decision.styleOverride === true;
  if (style.verdict === 'reject' && !override) {
    // 风格不对的图**不进包**：记进 rejected，等它拿到逐素材规格（裁到猪身）后自然会通过。
    rejected.push({ id: candidate.id, title: candidate.title, style });
    // 被拒的图绝不能留在 assets/img（package.files 收了该目录，会把它打进包）。
    rmSync(target, { force: true });
    console.log('  SKIP ' + candidate.id + ' 风格校验未通过（palette=' + style.palette + ' flatness=' + style.flatness + '）');
    continue;
  }

  // 判定通过才落盘：先写再判会让被拒的图残留在 assets/img 并被发出去。
  writeFileSync(target, payload);
  const produced = readFileSync(target);
  pigs.push({
    id: candidate.id,
    title: candidate.title,
    kind: decision.kind,
    note: decision.note,
    vector: decision.vector,
    file: 'assets/img/' + file,
    bytes: produced.length,
    sha256: createHash('sha256').update(produced).digest('hex'),
    size: { width: cropped.width, height: cropped.height },
    source: { url: candidate.url, group: candidate.source || 'pighub-online', sha256: sourceSha },
    cut: { trim: decision.cut.trim, white: decision.cut.white || 236 },
    style,
  });
}

function resizeNearest(frame, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(frame.height - 1, Math.floor((y * frame.height) / h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(frame.width - 1, Math.floor((x * frame.width) / w));
      const from = (sy * frame.width + sx) * 4;
      const to = (y * w + x) * 4;
      out[to] = frame.data[from];
      out[to + 1] = frame.data[from + 1];
      out[to + 2] = frame.data[from + 2];
      out[to + 3] = frame.data[from + 3];
    }
  }
  return { width: w, height: h, data: out };
}

function guessExt(filename, fallback) {
  const match = String(filename || '').match(/\.[a-z0-9]+$/i);
  return match ? match[0] : '.' + fallback;
}

pigs.sort((a, b) => a.id.localeCompare(b.id));
const manifest = {
  assetVersion: decisions.assetVersion,
  frozenAt: new Date().toISOString(),
  policy: '素材在构建期处理完并随包分发；运行时只读本地文件，不链接、不请求素材库。',
  attribution: '素材来自 PigHub 社区图库及其开源镜像，版权归原权利人；本项目仅做逐图判定与裁切，署名见 assets/ATTRIBUTION.md。',
  rejected,
  counts: {
    total: pigs.length,
    live: pigs.filter((pig) => pig.kind === 'live').length,
    dead: pigs.filter((pig) => pig.kind === 'dead').length,
    vector: pigs.filter((pig) => pig.vector).length,
  },
  pigs,
};
writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('OK  assetVersion=' + manifest.assetVersion
  + '  total=' + manifest.counts.total
  + '  live=' + manifest.counts.live
  + '  dead=' + manifest.counts.dead
  + '  vector=' + manifest.counts.vector);
for (const pig of pigs) {
  console.log('  ' + pig.id + '  ' + pig.kind + (pig.vector ? ' (svg)' : '') + '  '
    + pig.size.width + 'x' + pig.size.height + '  ' + pig.bytes + 'B  ' + pig.file + '  ' + pig.title);
}
