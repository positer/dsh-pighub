/**
 * 静默自动更新（用户口径 2026-11-14：「启动自动静默检查 npm 最新并自主静默更新到最新版本，
 * 不通知用户，不提供自动更新开关。」）+ 版本地板（用户口径 2026-11-19）。
 *
 * ## 2026-11-19 为什么重写安装这一段
 *
 * 上一版直接 \`pnpm add dsh-pighub@latest\`。实测（本机 pnpm 11.28.5）它有两个越权副作用：
 *   1. **把刚发布、还在成熟期内的版本写进 profile 的 lockfile**。整棵树的依赖共用一个 lockfile，
 *      pnpm 每次操作都会先校验整份 lockfile，于是下一次「装别的插件」或「升级 DSH」直接
 *      \`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION\` —— 别的插件的更新被 pighub 连坐。
 *   2. **静默改写 profile 的 \`pnpm-workspace.yaml\`**。pnpm 默认（非 strict）会把年轻版本自动追加进
 *      \`minimumReleaseAgeExclude\`，而且**顺带把 lockfile 里其它年轻包也加进去**（实测它替 newmark2dsh
 *      加了豁免）。一个插件不该有改整台机器信任策略的权力。
 *
 * 现在的规则只有两条，都不碰 profile 的策略文件：
 *   · **只装「发布满 24h」的版本**（= profile 自己的供应链成熟期，pnpm 11 的内置默认）。
 *     最新版还年轻就记一行 \`hold\` 等下一轮；权威版本号永远来自 registry 的 \`time\` 表，不是猜的。
 *   · **安装命令带一次性 \`--config.minimumReleaseAgeStrict=true\`**：让 pnpm 在遇到年轻版本时**拒绝**，
 *     而不是把豁免写进 \`pnpm-workspace.yaml\`。这是命令行覆盖，不落盘、不改任何配置。
 *     实测：成熟版本 + strict → exit 0 且不创建/不改写 workspace 文件；年轻版本 + strict →
 *     \`ERR_PNPM_NO_MATURE_MATCHING_VERSION\`，同样不动 policy 文件。
 *
 * 版本回退锁在 \`version-floor.js\`：地板只记在 \`~/.PigHub/version-floor.json\`，只升不降；
 * 本文件的 \`enforceFloor()\` 负责「发现回退后按 profile 的包管理器，把地板那一版装回来」。
 *
 * 依赖注入形状保持不变（fetch / exec / 读版本 / 日志都可替换），所以每条分支都能离线测。
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { compareSemver, isStableVersion } from './semver.js';
import { observeVersion } from './version-floor.js';

export { compareSemver } from './semver.js';

export const PACKAGE_NAME = 'dsh-pighub';
/** 整份 packument（不是 /latest）：要 \`time\` 表才能判一个版本发布多久了。 */
export const PACKUMENT_URL = 'https://registry.npmjs.org/' + PACKAGE_NAME;
export const INSTALL_TIMEOUT_MS = 180 * 1000;
/** 与 pnpm 11 的 minimumReleaseAge 默认值一致：24 小时。 */
export const RELEASE_AGE_MS = 24 * 60 * 60 * 1000;
/** 一次性命令行覆盖：遇到年轻版本时拒绝，而不是把豁免写进 pnpm-workspace.yaml。 */
export const STRICT_POLICY_ARG = '--config.minimumReleaseAgeStrict=true';

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

/** registry 的 \`time\` 表是 ISO 字符串；解析不了就当「没有发布时间」。 */
export function parsePublishTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 读整份 packument；失败返回 null（调用方据此判「离线」）。 */
export async function fetchPackument(fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  try {
    const res = await doFetch(PACKUMENT_URL, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object' || !body.versions || typeof body.versions !== 'object') return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * 从 packument 里挑「现在该装哪一版」，纯函数（时间由调用方给，测试可注入）：
 *   · latest         dist-tags.latest（缺失则取最高稳定版），只用于日志与扬升判断；
 *   · newestMature   发布满 ageMs 的最高稳定版；
 *   · target         newestMature 且严格高于 current 才装，否则 null；
 *   · heldYoung      latest 比 current 新、但它还没过成熟期 —— 这时只记日志、不动手。
 */
export function pickRelease(packument, currentVersion, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const ageMs = Number.isFinite(options.ageMs) ? options.ageMs : RELEASE_AGE_MS;
  const cutoff = nowMs - ageMs;
  const versions = Object.keys((packument && packument.versions) || {})
    .filter(isStableVersion)
    .sort((a, b) => compareSemver(b, a));
  const time = (packument && packument.time) || {};
  const tagged = packument && packument['dist-tags'] && isStableVersion(packument['dist-tags'].latest)
    ? String(packument['dist-tags'].latest).trim()
    : '';
  const latest = tagged || versions[0] || null;
  const mature = versions.filter((version) => {
    const published = parsePublishTime(time[version]);
    return published !== null && published <= cutoff;
  });
  const newestMature = mature[0] || null;
  const target = newestMature && compareSemver(newestMature, currentVersion) > 0 ? newestMature : null;
  const latestTime = latest ? parsePublishTime(time[latest]) : null;
  const heldYoung = !target && !!latest
    && compareSemver(latest, currentVersion) > 0
    && (latestTime === null || latestTime > cutoff);
  return { latest, latestTime, newestMature, target, heldYoung, cutoff, nowMs };
}

/** 读**盘上**装着的版本号。装没装成只认它，不认命令退出码。 */
export function readInstalledVersion(profileDir) {
  try {
    const raw = readFileSync(join(String(profileDir || ''), 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8');
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
 *   · 否则当 npm 目录处理（--no-save --no-package-lock：绝不改写用户的 dependencies 与 lockfile）。
 * pnpm 的两条候选依次是 PATH 上的 pnpm 与 DSH 自带的那份；两条都没有就返回 null（调用方放弃并记日志）。
 * pnpm 的每次安装都带一次性 strict 覆盖，理由见文件头（拒绝，而不是偷偷写豁免）。
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
      argsFor: (version) => ['install', PACKAGE_NAME + '@' + version, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'],
    };
  }
  const bundled = bundledPnpm();
  return {
    kind: 'pnpm',
    command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    argsFor: (version) => ['add', PACKAGE_NAME + '@' + version, '--reporter=silent', STRICT_POLICY_ARG],
    fallback: bundled
      ? { kind: 'pnpm-bundled', command: process.execPath, argsFor: (version) => [bundled, 'add', PACKAGE_NAME + '@' + version, '--reporter=silent', STRICT_POLICY_ARG] }
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
 * status：
 *   · current             registry 与本机同版本（或没有更成熟的版本），什么都不做；
 *   · ahead               本机比 registry 新（存在未发布的修复），什么都不做，但日志要写明；
 *   · held                最新版比本机新，但还没过 24h 成熟期 —— 只记日志，等下一轮；
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
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const ageMs = Number.isFinite(options.ageMs) ? options.ageMs : RELEASE_AGE_MS;

  const packument = await fetchPackument(fetchImpl);
  if (!packument) {
    writeLog('check offline_or_failed current=' + currentVersion);
    return { status: 'offline', currentVersion, latest: null };
  }

  const pick = pickRelease(packument, currentVersion, { nowMs, ageMs });
  if (!pick.latest) {
    writeLog('check offline_or_failed current=' + currentVersion + ' reason=no_versions');
    return { status: 'offline', currentVersion, latest: null };
  }
  if (compareSemver(pick.latest, currentVersion) < 0) {
    // 这一行是 2026-11-18 事故里最该有的那行：本地比 npm 新，说明手里有未发布的修复。
    writeLog('check ahead current=' + currentVersion + ' latest=' + pick.latest + ' (local is newer than registry)');
    return { status: 'ahead', currentVersion, latest: pick.latest };
  }
  if (!pick.target) {
    if (pick.heldYoung) {
      const ageHours = pick.latestTime === null ? 'unknown' : ((nowMs - pick.latestTime) / 3600000).toFixed(1);
      writeLog('check hold current=' + currentVersion + ' latest=' + pick.latest + ' age_h=' + ageHours + ' (younger than the 24h release window)');
      return { status: 'held', currentVersion, latest: pick.latest, latestTime: pick.latestTime };
    }
    writeLog('check up_to_date current=' + currentVersion + ' latest=' + pick.latest);
    return { status: 'current', currentVersion, latest: pick.latest };
  }

  if (!profileDir) {
    writeLog('skip install: no profile dir (current=' + currentVersion + ' target=' + pick.target + ')');
    return { status: 'failed', currentVersion, latest: pick.latest, target: pick.target, reason: 'no_profile_dir' };
  }

  writeLog('install start current=' + currentVersion + ' -> ' + pick.target + ' profile=' + profileDir);
  const result = await runInstall({ version: pick.target, profileDir, execFileImpl, installer, writeLog });
  if (!result.ok) {
    writeLog('install failed target=' + pick.target + ' via=' + result.installer + ' reason=' + (result.code || 'error') + ' error=' + result.error);
    return { status: 'failed', currentVersion, latest: pick.latest, target: pick.target, reason: result.error || result.code };
  }

  const landed = readVersion(profileDir);
  if (landed && compareSemver(landed, pick.target) === 0) {
    writeLog('install ok target=' + pick.target + ' verified=' + landed + ' via=' + result.installer);
    return { status: 'installed', currentVersion, latest: pick.latest, target: pick.target, installedVersion: landed, installer: result.installer };
  }
  // exit 0 不等于装上：回读对不上就老实报未验证，别把「命令没报错」当成「已经升级」。
  writeLog('install unverified expected=' + pick.target + ' actual=' + (landed || 'unknown') + ' via=' + result.installer);
  return { status: 'install_unverified', currentVersion, latest: pick.latest, target: pick.target, installedVersion: landed, installer: result.installer };
}

/**
 * 版本地板：把「盘上正在跑的版本」喂给地板；发现回退（盘上 < 地板）就按 profile 的包管理器把地板那版装回来。
 *
 * 三条边界：
 *   · **只装地板那一版**，不动别的依赖 —— 这就是「只锁自己」；
 *   · 地板版本还没过成熟期时**不硬装**（记 \`held_young\`），因为那只能靠绕过策略完成，而绕过正是要禁掉的行为；
 *   · 永远 resolve，失败只写日志（启动路径不能因为一次修复失败就坏掉）。
 */
export async function enforceFloor(options = {}) {
  const rootDir = String(options.rootDir || '');
  const profileDir = String(options.profileDir || '');
  const installedVersion = String(options.installedVersion || options.currentVersion || '');
  const writeLog = typeof options.writeLog === 'function' ? options.writeLog : () => '';
  const readVersion = typeof options.readVersionImpl === 'function' ? options.readVersionImpl : readInstalledVersion;
  const execFileImpl = options.execFileImpl;
  const installer = options.installerImpl;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const ageMs = Number.isFinite(options.ageMs) ? options.ageMs : RELEASE_AGE_MS;

  const observed = observeVersion(rootDir, installedVersion, { nowMs, source: 'startup' });
  if (observed.raised) writeLog('floor raised floor=' + observed.floor + ' installed=' + observed.installed);
  if (!observed.rollback) return { status: 'ok', ...observed };

  writeLog('rollback detected installed=' + observed.installed + ' floor=' + observed.floor + ' (only dsh-pighub is touched)');
  if (!profileDir) {
    writeLog('rollback repair skipped: no profile dir');
    return { status: 'rollback', repair: 'skipped', ...observed };
  }

  const packument = await fetchPackument(options.fetchImpl);
  const published = packument ? parsePublishTime((packument.time || {})[observed.floor]) : null;
  if (published !== null && nowMs - published < ageMs) {
    writeLog('rollback repair held: floor ' + observed.floor + ' is younger than the 24h release window');
    return { status: 'rollback', repair: 'held_young', ...observed };
  }

  const result = await runInstall({ version: observed.floor, profileDir, execFileImpl, installer, writeLog });
  if (!result.ok) {
    writeLog('rollback repair failed floor=' + observed.floor + ' via=' + result.installer + ' reason=' + (result.code || 'error') + ' error=' + result.error);
    return { status: 'rollback', repair: 'failed', ...observed };
  }
  const landed = readVersion(profileDir);
  if (landed && compareSemver(landed, observed.floor) === 0) {
    writeLog('rollback repaired floor=' + observed.floor + ' verified=' + landed + ' via=' + result.installer);
    return { status: 'repaired', repair: 'installed', ...observed };
  }
  writeLog('rollback repair unverified expected=' + observed.floor + ' actual=' + (landed || 'unknown') + ' via=' + result.installer);
  return { status: 'rollback', repair: 'unverified', ...observed };
}
