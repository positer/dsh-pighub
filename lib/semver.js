/**
 * 语义化版本比较：只比较数字段，忽略预发布后缀（`1.0.12-rc.1` 与 `1.0.12` 视为同版）。
 *
 * 单独成一个文件，是因为两处都要用它：auto-update（挑「够成熟」的目标版本）与
 * version-floor（判一次安装是不是把版本往下拉了）。若让 version-floor 从 auto-update 里 import，
 * 两者就成了 ESM 循环依赖 —— 能跑，但没人希望在版本判断这种地方依赖求值顺序。
 */

/** 把 `v1.2.3` / `1.2` / `1.2.3-beta.1` 归一成数字数组；非法段按 0 处理。 */
function parseVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** 返回 -1 / 0 / 1。a < b 即 -1。 */
export function compareSemver(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length, 3);
  for (let index = 0; index < len; index += 1) {
    const x = left[index] || 0;
    const y = right[index] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 只认「三段数字、无预发布后缀」的稳定版本；registry 的 versions 表里还混着 dist 标签与弃用条目。 */
export function isStableVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value.trim());
}
