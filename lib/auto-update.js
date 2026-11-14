/**
 * 静默自动更新（用户口径 2026-11-14）：
 *   「启动自动静默检查 npm 最新并自主静默更新到最新版本，不通知用户，不提供自动更新开关。」
 *
 * 三条硬约束：
 *   1. **不打扰**：没有任何 UI、没有开关；失败只写日志。
 *   2. **不阻塞**：调用方延迟触发、本模块内部全部 try/catch，永远 resolve。
 *   3. **不误判**：版本比较必须是语义化的（0.9.9 < 0.9.10），不能拿字符串比。
 *
 * 这个模块刻意做成「依赖注入」形状：fetch / exec / 日志写入都可以被测试替换，
 * 所以三条分支（有新版 / 已最新 / 网络失败）能在离线测试里全部覆盖。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';

export const PACKAGE_NAME = 'dsh-pighub';
export const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/' + PACKAGE_NAME + '/latest';
export const INSTALL_TIMEOUT_MS = 180 * 1000;

/** 语义化版本比较：返回 -1 / 0 / 1。只比较数字段，忽略预发布后缀。 */
export function compareSemver(a, b) {
  const parse = (value) => String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length, 3);
  for (let index = 0; index < len; index += 1) {
    const x = left[index] || 0;
    const y = right[index] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 往 ~/.PigHub/logs/auto-update.log 追加一行；任何失败都吞掉（日志不能反过来搞坏功能）。 */
export function makeFileLogger(rootDir) {
  const dir = join(rootDir, 'logs');
  const file = join(dir, 'auto-update.log');
  return (line) => {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, new Date().toISOString() + ' ' + line + '\n', 'utf8');
    } catch { /* ignore */ }
    return file;
  };
}

/** 读 registry 上的 latest 版本号；失败返回 null（调用方据此判「离线」）。 */
export async function fetchLatestVersion(fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  try {
    const res = await doFetch(REGISTRY_LATEST_URL, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const version = body && typeof body.version === 'string' ? body.version.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

/** 在 profile 目录里装指定版本；用 npm（pnpm 的 profile 目录结构里 npm 也能装到 node_modules）。 */
function runInstall({ version, profileDir, execFileImpl }) {
  const exec = execFileImpl || execFileCallback;
  return new Promise((resolve) => {
    try {
      const child = exec(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['install', PACKAGE_NAME + '@' + version, '--no-audit', '--no-fund', '--loglevel=error'],
        { cwd: profileDir, timeout: INSTALL_TIMEOUT_MS, windowsHide: true, stdio: 'ignore' },
        (error) => resolve({ ok: !error, error: error ? String(error.message || error).slice(0, 200) : '' }),
      );
      if (child && typeof child.unref === 'function') child.unref();
    } catch (error) {
      resolve({ ok: false, error: String((error && error.message) || error).slice(0, 200) });
    }
  });
}

/**
 * 跑一次检查 + 可能的升级。永远 resolve，永远不抛。
 * 返回 { status: 'current' | 'installed' | 'offline' | 'failed', ... } 供日志与测试断言。
 */
export async function runAutoUpdate(options = {}) {
  const currentVersion = String(options.currentVersion || '0.0.0');
  const profileDir = String(options.profileDir || '');
  const writeLog = typeof options.writeLog === 'function' ? options.writeLog : () => '';
  const fetchImpl = options.fetchImpl;
  const execFileImpl = options.execFileImpl;

  const latest = await fetchLatestVersion(fetchImpl);
  if (!latest) {
    writeLog('check offline_or_failed current=' + currentVersion);
    return { status: 'offline', currentVersion, latest: null };
  }

  const compare = compareSemver(latest, currentVersion);
  if (compare <= 0) {
    writeLog('check up_to_date current=' + currentVersion + ' latest=' + latest);
    return { status: 'current', currentVersion, latest };
  }

  if (!profileDir) {
    writeLog('skip install: no profile dir (current=' + currentVersion + ' latest=' + latest + ')');
    return { status: 'failed', currentVersion, latest, reason: 'no_profile_dir' };
  }

  writeLog('install start current=' + currentVersion + ' -> ' + latest + ' profile=' + profileDir);
  const result = await runInstall({ version: latest, profileDir, execFileImpl });
  if (result.ok) {
    writeLog('install ok latest=' + latest);
    return { status: 'installed', currentVersion, latest };
  }
  writeLog('install failed latest=' + latest + ' error=' + result.error);
  return { status: 'failed', currentVersion, latest, reason: result.error };
}
