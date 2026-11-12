/**
 * 冻结素材库的读取层（Host 半）。
 *
 * 事实来源只有一处：包里的 assets/manifest.json。它由 scripts/build-assets.mjs 生成，
 * 每一张图都带着**逐图判定**（live/dead）、**定制切分参数**（归一化裁切框 + 去白阈值）
 * 和**源图指纹**（sha256 / bytes）。
 *
 * 为什么抽猪池只认它：实时目录会让「今天抽到的猪」在不同版本/不同时刻长得不一样，
 * 收藏记录也就无法复现。冻结之后，同一版本永远是同一批猪、同一套切分。
 * 实时目录仍然保留，但只作为**下一版的候选池**出现在设置里。
 */
import { readFileSync, existsSync } from 'node:fs';

export const MANIFEST_PATH = new URL('../assets/manifest.json', import.meta.url);

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

/**
 * 冻结库 → 抽取池。字段与 draw() 期望的条目同形，另附 kind / cut / sha256。
 * 排序固定（按 id），所以同样的清单每次抽取池顺序一致——配合可注入的 rng 可以完全复现。
 */
export function assetPool(manifest) {
  const pigs = (manifest && Array.isArray(manifest.pigs) ? manifest.pigs : []).slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    images: pigs.map((pig) => ({
      id: pig.id,
      title: pig.title,
      filename: String(pig.source && pig.source.url ? pig.source.url.split('/').pop() : pig.id),
      imageUrl: pig.source && pig.source.url ? pig.source.url : '',
      kind: pig.kind === 'dead' ? 'dead' : 'live',
      cut: pig.cut || { trim: [0, 0, 1, 1], white: 236 },
      sha256: pig.source ? pig.source.sha256 : '',
      note: pig.note || '',
    })),
  };
}

/** 面板/工具用的摘要。 */
export function assetSummary(manifest) {
  if (!manifest) return { version: '', total: 0, live: 0, dead: 0, available: false };
  const pigs = manifest.pigs || [];
  const live = pigs.filter((pig) => pig.kind === 'live').length;
  return {
    version: manifest.assetVersion || '',
    frozenAt: manifest.frozenAt || '',
    total: pigs.length,
    live,
    dead: pigs.length - live,
    available: true,
  };
}
