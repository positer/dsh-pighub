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
  return name ? ASSET_ROUTE + '/' + name : '';
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
