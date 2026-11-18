/**
 * 发布顺序闸门：**不许把 npm 上的 latest 往回推**。
 *
 * 为什么值得单独一步：npm 只拒绝「同一个版本号重复发布」，它**不拒绝**把 0.9.9 发在一个已经有 1.0.0 的包上
 * —— 那样 `npm view <pkg> version` 会立刻指回旧版，所有靠「升到 latest」自愈的客户端会被集体拽回去。
 * 这就是 2026-11-18 那次「热补丁被覆盖回旧版」的发布侧同构版，所以要拦在发出去之前。
 *
 * 判据（凭据之外就能算，不依赖任何 secret）：
 *   · 本仓版本 **>** registry latest  → 放行（正常升级）
 *   · 本仓版本 **=** registry latest  → 拦（重复发布没有意义，npm 也会拒）
 *   · 本仓版本 **<** registry latest  → 拦（回退，绝不允许）
 *   · 取不到 registry（离线/限流）      → **告警放行**：宁可让真正的失败留给 npm 的重复发布检查，
 *     也不要因为一次网络抖动把紧急修复堵死。这一点是刻意的，写在日志里。
 *
 * 实现注记：用 node:https 而不是全局 fetch。实测（Node 24 / Windows）在 fetch 之后立刻 process.exit
 * 会触发 libuv 断言 `!(handle->flags & UV_HANDLE_CLOSING)`，退出码变成 0xC0000409 —— 一个「校验通过」
 * 的发布闸门绝不能因为自身实现把流水线判成失败。
 *
 * 用法：node scripts/check-release-order.mjs [version]
 */
import { readFileSync } from 'node:fs';
import { get } from 'node:https';

const PACKAGE_NAME = 'dsh-pighub';
const REGISTRY_LATEST = 'https://registry.npmjs.org/' + PACKAGE_NAME + '/latest';
const TIMEOUT_MS = 15000;

function parseSemver(value) {
  const parts = String(value || '').trim().replace(/^v/i, '').split('-')[0].split('.');
  return [0, 1, 2].map((index) => {
    const n = Number.parseInt(parts[index], 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function compare(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function readLatest() {
  return new Promise((resolve) => {
    const request = get(REGISTRY_LATEST, { headers: { accept: 'application/json', connection: 'close' }, timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ ok: false, reason: 'HTTP ' + res.statusCode });
        return;
      }
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(text);
          if (body && typeof body.version === 'string') resolve({ ok: true, version: body.version.trim() });
          else resolve({ ok: false, reason: 'no version field' });
        } catch {
          resolve({ ok: false, reason: 'bad json' });
        }
      });
    });
    request.on('error', (error) => resolve({ ok: false, reason: (error && (error.code || error.message)) || 'request failed' }));
    request.on('timeout', () => { request.destroy(); resolve({ ok: false, reason: 'timeout' }); });
  });
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const candidate = String(process.argv[2] || pkg.version).trim();
const latest = await readLatest();

if (!latest.ok) {
  console.warn('WARN  取不到 registry 的 latest（' + latest.reason + '）：按离线放行，最终仍由 npm 的重复发布检查兜底');
  process.exit(0);
}

const order = compare(candidate, latest.version);
if (order > 0) {
  console.log('OK    ' + PACKAGE_NAME + ' ' + latest.version + ' → ' + candidate + '（升级，放行）');
  process.exit(0);
}
if (order === 0) {
  console.error('STOP  ' + PACKAGE_NAME + '@' + candidate + ' 已经是 registry 上的 latest，没有可发布的内容');
  process.exit(1);
}
console.error('STOP  拒绝回退：本仓 ' + candidate + ' < registry latest ' + latest.version);
console.error('      npm 不会拦这种发布，但发出去会让所有「升到 latest」的客户端集体退回旧版。');
console.error('      要发就先把 package.json 的版本提到 ' + latest.version + ' 之上。');
process.exit(1);
