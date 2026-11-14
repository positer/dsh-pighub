/**
 * 猪圈主题包（用户口径 2026-11-14）：
 *   「将猪圈主题配置（草地、栏杆-前后左右）打包并开发自定义，在设置中更换，主题包保存在 .PigHub。」
 *
 * 结构：一个目录 = 一个主题
 *   ~/.PigHub/themes/<name>/
 *     theme.json   { name?, title?, author?, version?, geometry?{grass,inner,box}, fence?{image?,split?,back?,front?}, grassImage?, house? }
 *     fence-back.png / fence-front.png / grass.png / house.png（都可以缺）
 *
 * 原则：
 *   1. **内置 classic 必须永远可用**——外部主题缺字段、缺图、JSON 坏掉，一律回落它，绝不白屏；
 *   2. geometry 是**百分比**（与 client 里 PEN_GRASS/PEN_INNER/PEN_BOX 同构），缺省就用 classic 的值；
 *   3. 这个模块只做「读 + 校验 + 归一」，不碰 DOM、不碰路由（路由在 index.js）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const THEME_ROUTE = '/pighub/theme';
export const CLASSIC_THEME_NAME = 'classic';

/** classic 的几何：与 lib/client.js 的 PEN_GRASS / PEN_INNER / PEN_BOX 完全一致（改这里就必须同步改那边）。 */
export const CLASSIC_GEOMETRY = {
  grass: [8.37, 18.26, 91.47, 96.65],
  inner: [13.40, 19.70, 86.60, 81.74],
  box: [24.04, 29.16, 75.96, 72.28],
};

/** classic 的布景：用包内那一张 pen-fence.png，按 50.68% 切成远/近两层。 */
export const CLASSIC_FENCE = { image: 'pen-fence.png', split: 0.5068 };

/** 主题里允许的图片文件名（防穿越：不许 ../、不许绝对路径）。 */
const SAFE_FILE = /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|svg)$/;

function normaliseRect(value, fallback) {
  if (!Array.isArray(value) || value.length !== 4) return fallback.slice();
  const nums = value.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return fallback.slice();
  // 百分比一律夹到 0..100，且保证 left<right / top<bottom，否则回落（坏数据不该把猪圈画崩）
  const [left, top, right, bottom] = nums.map((n) => Math.min(100, Math.max(0, n)));
  if (!(left < right) || !(top < bottom)) return fallback.slice();
  return [left, top, right, bottom];
}

/** 把任意 theme.json 归一成「一定可用」的形状；坏字段逐项回落 classic。 */
export function normaliseTheme(raw, name) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const geometry = source.geometry && typeof source.geometry === 'object' ? source.geometry : {};
  const fence = source.fence && typeof source.fence === 'object' ? source.fence : {};
  const split = Number(fence.split);
  return {
    name: String(source.name || name || CLASSIC_THEME_NAME),
    title: String(source.title || name || CLASSIC_THEME_NAME),
    author: typeof source.author === 'string' ? source.author : '',
    version: typeof source.version === 'string' ? source.version : '',
    geometry: {
      grass: normaliseRect(geometry.grass, CLASSIC_GEOMETRY.grass),
      inner: normaliseRect(geometry.inner, CLASSIC_GEOMETRY.inner),
      box: normaliseRect(geometry.box, CLASSIC_GEOMETRY.box),
    },
    fence: {
      image: SAFE_FILE.test(String(fence.image || '')) ? String(fence.image) : CLASSIC_FENCE.image,
      back: SAFE_FILE.test(String(fence.back || '')) ? String(fence.back) : '',
      front: SAFE_FILE.test(String(fence.front || '')) ? String(fence.front) : '',
      split: Number.isFinite(split) && split > 0.05 && split < 0.95 ? split : CLASSIC_FENCE.split,
    },
    grassImage: SAFE_FILE.test(String(source.grassImage || '')) ? String(source.grassImage) : '',
    houseImage: source.house && SAFE_FILE.test(String(source.house.image || '')) ? String(source.house.image) : '',
  };
}

/** 读一个主题目录；theme.json 坏掉/缺失就返回 classic 的形状（不抛）。 */
export function readThemeDir(dir, name) {
  const fallback = normaliseTheme({}, name);
  try {
    if (!dir || !existsSync(dir)) return fallback;
    const jsonPath = join(dir, 'theme.json');
    if (!existsSync(jsonPath)) return fallback;
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    return normaliseTheme(raw, name);
  } catch {
    return fallback;
  }
}

/**
 * 列主题：内置 classic 永远排第一，然后是 ~/.PigHub/themes 下的目录（按名字排序）。
 * 每个条目只有 name/title，够设置面板渲染；完整定义由 readThemeDir 再读。
 */
export function listThemes(builtinDir, userThemesDir) {
  const seen = new Set([CLASSIC_THEME_NAME]);
  const items = [{ name: CLASSIC_THEME_NAME, title: 'classic（默认）', builtin: true }];
  try {
    if (userThemesDir && existsSync(userThemesDir)) {
      for (const entry of readdirSync(userThemesDir)) {
        if (seen.has(entry)) continue;
        const dir = join(userThemesDir, entry);
        let isDir = false;
        try { isDir = statSync(dir).isDirectory(); } catch { isDir = false; }
        if (!isDir) continue;
        seen.add(entry);
        const theme = readThemeDir(dir, entry);
        items.push({ name: entry, title: theme.title || entry, builtin: false });
      }
    }
  } catch { /* 目录读不了就当没有外部主题 */ }
  return items;
}

/** 主题图片的绝对路径；找不到返回 null（路由据此 404，客户端回落到 classic）。 */
export function themeAssetPath({ name, file, builtinDir, userThemesDir }) {
  if (!SAFE_FILE.test(String(file || ''))) return null;
  if (name && name !== CLASSIC_THEME_NAME) {
    const candidate = join(userThemesDir || '', String(name), String(file));
    if (userThemesDir && existsSync(candidate)) return candidate;
  }
  const builtin = join(builtinDir || '', String(file));
  return existsSync(builtin) ? builtin : null;
}

/**
 * 严格校验一个**待导入**的主题包（用户口径 2026-11-14：「不合法主题要拒绝」）。
 * 与 normaliseTheme 的区别：normaliseTheme 是给**已存在**的主题做逐字段兜底（宁可显示 classic 也不崩）；
 * 这里是**准入闸门**——不合规就直接拒绝并说明原因，绝不悄悄当成成功。
 */
export function validateThemePack(meta, files, prefix) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, reason: 'theme_json_not_object' };
  const name = String(meta.name || prefix.replace(/\/$/, '')).trim();
  if (!/^[a-zA-Z0-9._-]{1,48}$/.test(name)) return { ok: false, reason: 'theme_name_invalid:' + name };
  if (name === CLASSIC_THEME_NAME) return { ok: false, reason: 'theme_name_reserved:classic' };
  const rel = files.map((f) => (f.name.startsWith(prefix) ? f.name.slice(prefix.length) : f.name)).filter((n) => n && !n.endsWith('/'));
  const hasImage = rel.some((n) => /\.(png|jpg|jpeg|webp|svg)$/i.test(n));
  const geo = meta.geometry;
  let hasGeometry = false;
  if (geo !== undefined) {
    if (!geo || typeof geo !== 'object' || Array.isArray(geo)) return { ok: false, reason: 'geometry_not_object' };
    for (const key of ['grass', 'inner', 'box']) {
      const value = geo[key];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.length !== 4 || value.some((n) => !Number.isFinite(Number(n)))) {
        return { ok: false, reason: 'geometry_invalid:' + key };
      }
      const [l, t, r, b] = value.map(Number);
      if (!(l >= 0 && t >= 0 && r <= 100 && b <= 100)) return { ok: false, reason: 'geometry_out_of_range:' + key };
      if (!(l < r) || !(t < b)) return { ok: false, reason: 'geometry_inverted:' + key };
      hasGeometry = true;
    }
  }
  if (!hasImage && !hasGeometry) return { ok: false, reason: 'theme_has_nothing:需要至少一张图片或一段合法 geometry' };
  const fence = meta.fence;
  if (fence && typeof fence === 'object' && fence.image) {
    const img = String(fence.image);
    if (!/\.(png|jpg|jpeg|webp|svg)$/i.test(img)) return { ok: false, reason: 'fence_image_not_image:' + img };
    if (rel.indexOf(img) < 0) return { ok: false, reason: 'fence_image_missing:' + img };
  }
  for (const one of rel) {
    if (!/\.(json|png|jpg|jpeg|webp|svg)$/i.test(one)) return { ok: false, reason: 'unexpected_file:' + one };
  }
  return { ok: true, reason: '', name };
}
