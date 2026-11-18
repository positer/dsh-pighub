/**
 * 静默自动更新（用户口径 2026-11-14）：
 *   「启动自动静默检查 npm 最新并自主静默更新到最新版本，不通知用户，不提供自动更新开关。」
 *
 * 三条硬约束（1.0.11 之后仍然成立）：
 *   1. **不打扰**：没有任何 UI、没有开关；失败只写日志。
 *   2. **不阻塞**：调用方延迟触发、本模块内部全部 try/catch，永远 resolve。
 *   3. **不误判**：版本比较必须是语义化的（0.9.9 < 0.9.10），不能拿字符串比。
 *
 * 1.0.11（2026-11-18）修的四处，全部来自「日志能读出来、但没人读」的那次事故：
 *   · **AHEAD 不再冒充 up_to_date**：本地 1.0.10、registry 1.0.6 时旧代码写的是 `up_to_date`，
 *     等于把「你本地跑着四个未发布的修复」这件最重要的事实说成了「没事」。现在单独记 `ahead`。
 *   · **用 profile 自己的包管理器**：profile 是 pnpm 目录（有 pnpm-lock.yaml 或 node_modules/.pnpm）就用 pnpm，
 *     **绝不**在 pnpm 树上跑 `npm install` —— 那会改写 dependencies 的 spec 并与 pnpm-lock 打架，
 *     正是「热补丁被依赖重装覆盖回旧版」这一类事故的形态。pnpm 找不到就写日志放弃，不做危险动作。
 *   · **装完要验版本**：命令 exit 0 不等于装上了。装完回读 `node_modules/dsh-pighub/package.json`，
 *     版本对不上就报 `install_unverified`，而不是报 ok。
 *   · **谁装的写进日志**：pnpm / 内置 pnpm / 放弃，一条日志里能看出走了哪条路。
 *
 * 这个模块刻意做成「依赖注入」形状：fetch / exec / 读版本 / 日志写入都可以被测试替换，
 * 所以各条分支（有新版 / 已最新 / 本地更新 / 网络失败 / 装失败 / 装了但没装上）能在离线测试里全部覆盖。
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

/** 读**盘上**装着的版本号。装没装成只认它，不认命令退出码。 */
export function readInstalledVersion(profileDir) {
  try {
    const raw = readFileSync(join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.version === 'string' ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

/** DSH 桌面版随包带的 pnpm（<install>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs）。 */
function bundledPnpm() {
  try {
    const candidate = join(dirname(process.execPath), 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * 选包管理器。判据是目录形态，不是猜：
 *   · 有 pnpm-lock.yaml 或 node_modules/.pnpm ⇒ pnpm 管理的 profile；
 *   · 否则当 npm 目录处理（用 --no-save：绝不改写用户的 dependencies spec）。
 * pnpm 的两条候选依次是 PATH 上的 pnpm 与 DSH 自带的那份；两条都没有就返回 null（调用方放弃并记日志）。
 */
export function resolveInstaller(profileDir, platform = process.platform) {
  let isPnpm = false;
  try {
    isPnpm = existsSync(join(profileDir, 'pnpm-lock.yaml')) || existsSync(join(profileDir, 'node_modules', '.pnpm'));
  } catch { isPnpm = false; }
  if (!isPnpm) {
    return {
      kind: 'npm',
      command: platform === 'win32' ? 'npm.cmd' : 'npm',
      argsFor: (version) => ['install', PACKAGE_NAME + '@' + version, '--no-save', '--no-audit', '--no-fund', '--loglevel=error'],
    };
  }
  const bundled = bundledPnpm();
  return {
    kind: 'pnpm',
    command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    argsFor: (version) => ['add', PACKAGE_NAME + '@' + version, '--reporter=silent'],
    fallback: bundled
      ? { kind: 'pnpm-bundled', command: process.execPath, argsFor: (version) => [bundled, 'add', PACKAGE_NAME + '@' + version, '--reporter=silent'] }
      : null,
  };
}

/** 用某条命令装一次；返回 { ok, code, error }，永不抛。 */
function runOnce({ installer, version, profileDir, execFileImpl }) {
  const exec = execFileImpl || execFileCallback;
  return new Promise((resolve) => {
    try {
      const child = exec(
        installer.command,
        installer.argsFor(version),
        { cwd: profileDir, timeout: INSTALL_TIMEOUT_MS, windowsHide: true, stdio: 'ignore' },
        (error) => resolve({
          ok: !error,
          code: error && typeof error.code === 'string' ? error.code : '',
          error: error ? String(error.message || error).slice(0, 200) : '',
        }),
      );
      if (child && typeof child.unref === 'function') child.unref();
    } catch (error) {
      resolve({ ok: false, code: '', error: String((error && error.message) || error).slice(0, 200) });
    }
  });
}

/** 装一次；pnpm 不存在（ENOENT）时退到 DSH 自带的 pnpm，都失败就原样返回失败。 */
async function runInstall({ version, profileDir, execFileImpl, installer, writeLog }) {
  const chosen = installer || resolveInstaller(profileDir);
  if (!chosen) {
    writeLog('skip install: no pnpm for a pnpm-managed profile (refusing to run npm on a pnpm tree)');
    return { ok: false, code: 'no_pnpm', error: 'no pnpm available', installer: 'none' };
  }
  let result = await runOnce({ installer: chosen, version, profileDir, execFileImpl });
  let used = chosen.kind;
  if (!result.ok && result.code === 'ENOENT' && chosen.fallback) {
    writeLog('install retry: ' + chosen.kind + ' missing, trying ' + chosen.fallback.kind);
    result = await runOnce({ installer: chosen.fallback, version, profileDir, execFileImpl });
    used = chosen.fallback.kind;
  }
  return { ...result, installer: used };
}

/**
 * 跑一次检查 + 可能的升级。永远 resolve，永远不抛。
 *
 * 返回 status：
 *   · current             registry 与本机同版本，什么都不做；
 *   · ahead               本机比 registry 新（存在未发布的修复），什么都不做，但日志要写明；
 *   · installed           装了，且**回读版本对得上**；
 *   · install_unverified  命令成功了但盘上版本不对（打包/权限/缓存问题），按失败对待；
 *   · failed              没装成（没有 pnpm / 命令报错 / 没有 profile 目录）；
 *   · offline             取不到 registry。
 */
export async function runAutoUpdate(options = {}) {
  const currentVersion = String(options.currentVersion || '0.0.0');
  const profileDir = String(options.profileDir || '');
  const writeLog = typeof options.writeLog === 'function' ? options.writeLog : () => '';
  const fetchImpl = options.fetchImpl;
  const execFileImpl = options.execFileImpl;
  const readVersion = typeof options.readVersionImpl === 'function' ? options.readVersionImpl : readInstalledVersion;
  const installer = options.installerImpl;

  const latest = await fetchLatestVersion(fetchImpl);
  if (!latest) {
    writeLog('check offline_or_failed current=' + currentVersion);
    return { status: 'offline', currentVersion, latest: null };
  }

  const compare = compareSemver(latest, currentVersion);
  if (compare < 0) {
    // 这一行是 2026-11-18 事故里最该有的那行：本地比 npm 新，说明手里有未发布的修复。
    writeLog('check ahead current=' + currentVersion + ' latest=' + latest + ' (local is newer than registry)');
    return { status: 'ahead', currentVersion, latest };
  }
  if (compare === 0) {
    writeLog('check up_to_date current=' + currentVersion + ' latest=' + latest);
    return { status: 'current', currentVersion, latest };
  }

  if (!profileDir) {
    writeLog('skip install: no profile dir (current=' + currentVersion + ' latest=' + latest + ')');
    return { status: 'failed', currentVersion, latest, reason: 'no_profile_dir' };
  }

  writeLog('install start current=' + currentVersion + ' -> ' + latest + ' profile=' + profileDir);
  const result = await runInstall({ version: latest, profileDir, execFileImpl, installer, writeLog });
  if (!result.ok) {
    writeLog('install failed latest=' + latest + ' via=' + result.installer + ' reason=' + (result.code || 'error') + ' error=' + result.error);
    return { status: 'failed', currentVersion, latest, reason: result.error || result.code };
  }

  const landed = readVersion(profileDir);
  if (landed && compareSemver(landed, latest) === 0) {
    writeLog('install ok latest=' + latest + ' verified=' + landed + ' via=' + result.installer);
    return { status: 'installed', currentVersion, latest, installedVersion: landed, installer: result.installer };
  }
  // exit 0 不等于装上：回读对不上就老实报未验证，别把「命令没报错」当成「已经升级」。
  writeLog('install unverified expected=' + latest + ' actual=' + (landed || 'unknown') + ' via=' + result.installer);
  return { status: 'install_unverified', currentVersion, latest, installedVersion: landed, installer: result.installer };
}
