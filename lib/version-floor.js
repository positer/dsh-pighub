/**
 * 版本地板（版本回退锁）—— **只约束 dsh-pighub 自己**。
 *
 * 用户口径（2026-11-19）：「版本回退锁只能在本插件内限制本插件的版本回退，不允许权限溢出行为。」
 * 所以这里的整体设计只有一条规则、一个文件：
 *   · 规则：这枚插件见过的**最高版本**记在 `~/.PigHub/version-floor.json`，只升不降；
 *   · 落点：`~/.PigHub` 是插件自己的数据目录，写它不改变宿主、不改变 profile。
 *
 * 为什么不在 profile 里钉版本（上一版的形态，已作废）：
 *   profile 的 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` 是**整棵树**共用的。
 *   把一个刚发布、还在供应链成熟期内的版本钉进 lockfile，会让整棵树过不了 profile 的策略校验，
 *   于是别的插件装不动、DSH 也升不动 —— 那是「权限溢出」，不是「锁自己的版本」。
 *   地板只回答一个问题：「这台机器上跑过的最新版是哪一版」，答案只影响 pighub。
 *
 * 地板本身**不安装**任何东西：它只记录与判定。要不要重装由 `auto-update.js` 的 enforceFloor 决定，
 * 而且重装必须走 profile 自己的包管理器（不绕过策略）。这样「判定」与「动手」分开，两件事各自可测。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareSemver, isStableVersion } from './semver.js';

/** 数据目录里的文件名。与 state.json / prefs.json 平级，备份/迁移时一起带走。 */
export const FLOOR_FILE = 'version-floor.json';

/** `<dataRoot>/version-floor.json`。 */
export function floorFilePath(rootDir) {
  return join(String(rootDir || ''), FLOOR_FILE);
}

/**
 * 读地板；文件不存在 / 坏 JSON / 版本号不合法都返回 null（当作「还没记过」）。
 * 这里刻意不抛：一个坏掉的地板文件不该让插件启动失败。
 */
export function readFloor(rootDir) {
  try {
    const parsed = JSON.parse(readFileSync(floorFilePath(rootDir), 'utf8'));
    if (!parsed || !isStableVersion(parsed.version)) return null;
    return {
      version: String(parsed.version).trim(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      source: typeof parsed.source === 'string' ? parsed.source : '',
    };
  } catch {
    return null;
  }
}

/** 原子落盘：先写 `.tmp` 再 rename，断电/并发都只会留下「旧的完整文件」或「新的完整文件」。 */
export function writeFloor(rootDir, version, options = {}) {
  const value = String(version || '').trim();
  if (!isStableVersion(value)) return false;
  try {
    const dir = String(rootDir || '');
    mkdirSync(dir, { recursive: true });
    const file = floorFilePath(dir);
    const payload = {
      version: value,
      updatedAt: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString(),
      source: typeof options.source === 'string' ? options.source : 'observed',
    };
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把一次「盘上装着的版本」喂给地板，返回判定结果：
 *   · floor     现在的地板版本（没有就是 null）
 *   · raised    这次把地板抬高了（首见 / 升级）
 *   · rollback  盘上版本**低于**地板 —— 这就是要锁的那件事
 *
 * 相等不算回退，也不算抬高：重复启动不该反复写盘。
 */
export function observeVersion(rootDir, installedVersion, options = {}) {
  const installed = isStableVersion(installedVersion) ? String(installedVersion).trim() : null;
  const current = readFloor(rootDir);
  const floor = current ? current.version : null;
  if (!installed) {
    return { floor, installed, raised: false, rollback: false, updatedAt: current ? current.updatedAt : null };
  }
  if (!floor) {
    writeFloor(rootDir, installed, options);
    return { floor: installed, installed, raised: true, rollback: false, updatedAt: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString() };
  }
  const order = compareSemver(installed, floor);
  if (order > 0) {
    writeFloor(rootDir, installed, options);
    return { floor: installed, installed, raised: true, rollback: false, updatedAt: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString() };
  }
  if (order < 0) {
    return { floor, installed, raised: false, rollback: true, updatedAt: current ? current.updatedAt : null };
  }
  return { floor, installed, raised: false, rollback: false, updatedAt: current ? current.updatedAt : null };
}
