/**
 * 冻结素材库的读取层（Host 半）。
 *
 * 素材在**构建期**就已经处理好并随包分发（见 scripts/build-assets.mjs）：运行时只读
 * `assets/manifest.json` 与 `assets/img/*`，**不访问素材库、不做任何图像计算**。
 * 每一版用哪几只猪、哪只是死猪、贴图是 PNG 还是 SVG，全部由清单决定。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';

export const MANIFEST_PATH = new URL('../assets/manifest.json', import.meta.url);
export const IMAGE_DIR = new URL('../assets/img/', import.meta.url);
export const ASSET_ROUTE = '/pighub/asset';

/*
 * 猪圈自己的图（不是素材库的一部分）：木栅栏那张 1254×1254 的方框。
 *
 * 为什么不挂在 /pighub/asset/ 下：那条前缀有一条硬不变式「清单里每只猪一条 exact 路由」
 * （test/host.test.mjs 按条数对账）。围栏不是猪，混进去会让那条断言变成「猪 + 1」，
 * 以后加第二张布景图又得改一次。单独一条前缀，两边各自对得上账。
 * 文件仍放在 assets/img 里（package.json 的 files 已经包含整个 assets/img，不用改发布清单）。
 */
export const PEN_ROUTE = '/pighub/pen';
export const PEN_ART = ['pen-fence.png'];

/** 读冻结库。缺失或坏掉都不抛：返回 null，由调用方决定怎么降级。 */
export function readAssetManifest() {
  try {
    if (!existsSync(MANIFEST_PATH)) return null;
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (!manifest || !Array.isArray(manifest.pigs) || manifest.pigs.length === 0) return null;
    return manifest;
  } catch {
    return null;
  }
}

/** 清单里的相对路径 → 本地贴图 URL（由 Host 半的静态路由提供）。 */
export function assetUrlOf(pig) {
  const file = pig && typeof pig.file === 'string' ? pig.file : '';
  const name = file.split('/').pop();
  if (!name) return '';
  // 内容指纹做 cache-buster：素材被补全/替换后 URL 会变，浏览器不可能再拿旧图
  // （2026-11-13 用户报「猪圈的斗鸡眼猪只有头、桌宠是全身」——磁盘和接口都是完整猪，
  //  纯粹是旧图被浏览器缓存住了）。
  const stamp = pig && typeof pig.sha256 === 'string' ? pig.sha256.slice(0, 8) : '';
  return ASSET_ROUTE + '/' + name + (stamp ? '?v=' + stamp : '');
}

/**
 * 冻结库 → 抽取池。字段与 draw() 期望的条目同形。
 * 排序固定（按 id），所以同样的清单每次抽取池顺序一致——配合可注入的 rng 可完全复现。
 */
export function assetPool(manifest) {
  const pigs = (manifest && Array.isArray(manifest.pigs) ? manifest.pigs : []).slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    images: pigs.map((pig) => ({
      id: pig.id,
      title: pig.title,
      filename: String(pig.file || '').split('/').pop(),
      imageUrl: assetUrlOf(pig),
      assetUrl: assetUrlOf(pig),
      kind: pig.kind === 'dead' ? 'dead' : 'live',
      vector: pig.vector === true,
      sha256: pig.sha256 || '',
      note: pig.note || '',
    })),
  };
}

/** 面板/工具用的摘要（含包内素材体积，便于核对「随包分发」）。 */
export function assetSummary(manifest) {
  if (!manifest) return { version: '', total: 0, live: 0, dead: 0, vector: 0, bytes: 0, available: false };
  const pigs = manifest.pigs || [];
  const live = pigs.filter((pig) => pig.kind === 'live').length;
  let bytes = 0;
  for (const pig of pigs) {
    try {
      const file = new URL('.' + '/' + String(pig.file || '').replace('assets/img/', ''), IMAGE_DIR);
      if (existsSync(file)) bytes += statSync(file).size;
    } catch { /* 文件缺失不影响摘要 */ }
  }
  return {
    version: manifest.assetVersion || '',
    frozenAt: manifest.frozenAt || '',
    total: pigs.length,
    live,
    dead: pigs.length - live,
    vector: pigs.filter((pig) => pig.vector).length,
    bytes,
    available: true,
  };
}
