#!/usr/bin/env node
/**
 * 静默自动更新 + 版本地板的分支测试（离线，不联网、不装包）。
 *
 * 2026-11-19 的两条新规矩必须在这里被钉住，否则会悄悄退回去：
 *   · **只装发布满 24h 的版本**（profile 的供应链成熟期）；最新版还年轻就记 hold、一次安装都不发起；
 *   · **安装命令带一次性 strict 覆盖**，且源码里不许出现任何「写 policy 文件 / 绕过策略」的东西 ——
 *     上一版就是靠 \`pnpm add latest\` 把年轻版本塞进 lockfile、把豁免写进 pnpm-workspace.yaml，
 *     结果别的插件和 DSH 全都升级失败。
 * 另外地板（版本回退锁）只约束 dsh-pighub 自己：回退时只装 floor 那一版，且年轻就不硬装。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STRICT_POLICY_ARG,
  compareSemver,
  enforceFloor,
  pickRelease,
  runAutoUpdate,
  resolveInstaller,
} from '../lib/auto-update.js';
import { FLOOR_FILE, readFloor, writeFloor } from '../lib/version-floor.js';

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass += 1; console.log('PASS  ' + name); }
  catch (error) { fail += 1; console.log('FAIL  ' + name + ' :: ' + (error && error.message)); }
};
const acheck = async (name, fn) => {
  try { await fn(); pass += 1; console.log('PASS  ' + name); }
  catch (error) { fail += 1; console.log('FAIL  ' + name + ' :: ' + (error && error.message)); }
};

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-19T03:00:00Z');
const packumentOf = (entries) => ({
  'dist-tags': { latest: entries[0].version },
  versions: Object.fromEntries(entries.map((entry) => [entry.version, { name: 'dsh-pighub', version: entry.version }])),
  time: Object.fromEntries(entries.map((entry) => [entry.version, new Date(entry.hoursAgo === null ? NOW : NOW - entry.hoursAgo * HOUR).toISOString()])),
});
const fetchJson = (body) => async () => ({ ok: true, json: async () => body });
const pnpmProfile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pighub-profile-'));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  return dir;
};
const fakeExec = (calls, outcome) => (file, args, _opts, cb) => {
  calls.push(file + ' ' + args.join(' '));
  cb(outcome || null);
  return { unref() {} };
};

check('版本比较是语义化的（0.9.9 < 0.9.10，不能按字符串比）', () => {
  assert.equal(compareSemver('0.9.9', '0.9.10'), -1);
  assert.equal(compareSemver('0.9.10', '0.9.9'), 1);
  assert.equal(compareSemver('0.9.61', '0.9.61'), 0);
  assert.equal(compareSemver('v0.9.61', '0.9.61'), 0);
  assert.equal(compareSemver('1.0.0', '0.9.99'), 1);
  assert.equal(compareSemver('0.9', '0.9.0'), 0);
});

check('挑目标：只挑「发布满 24h」的最高稳定版，最新的年轻版跳过', () => {
  const doc = packumentOf([
    { version: '1.0.12', hoursAgo: 2 },
    { version: '1.0.11', hoursAgo: 30 },
    { version: '1.0.10', hoursAgo: 60 },
  ]);
  const pick = pickRelease(doc, '1.0.10', { nowMs: NOW, ageMs: 24 * HOUR });
  assert.equal(pick.latest, '1.0.12', 'latest 仍是 registry 的最新版');
  assert.equal(pick.newestMature, '1.0.11');
  assert.equal(pick.target, '1.0.11', '要装的是成熟版，不是 1.0.12');
});

check('挑目标：没有更成熟的版本时 target 为空、heldYoung=true', () => {
  const doc = packumentOf([
    { version: '1.0.12', hoursAgo: 2 },
    { version: '1.0.11', hoursAgo: 30 },
  ]);
  const pick = pickRelease(doc, '1.0.11', { nowMs: NOW, ageMs: 24 * HOUR });
  assert.equal(pick.target, null);
  assert.equal(pick.heldYoung, true);
});

check('挑目标：没有 time 表的版本不算成熟（宁可等，也不猜它几岁）', () => {
  const doc = packumentOf([{ version: '1.0.12', hoursAgo: null }]);
  const pick = pickRelease(doc, '1.0.11', { nowMs: NOW, ageMs: 24 * HOUR });
  assert.equal(pick.target, null);
  assert.equal(pick.heldYoung, true);
});

await acheck('远端最新但年轻：记 hold，一次安装都不发起', async () => {
  const logs = [];
  let installed = 0;
  const out = await runAutoUpdate({
    currentVersion: '1.0.11',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.12', hoursAgo: 1 }, { version: '1.0.11', hoursAgo: 40 }])),
    execFileImpl: () => { installed += 1; return { unref() {} }; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'held');
  assert.equal(installed, 0, '年轻版本不许装');
  assert.ok(logs.some((l) => l.indexOf('check hold') >= 0 && l.indexOf('age_h=') >= 0), '日志要写清为什么等：' + JSON.stringify(logs));
});

await acheck('远端有更成熟的版本：装成熟版（不是最新版），并带 strict 一次性覆盖', async () => {
  const dir = pnpmProfile();
  const calls = [];
  const out = await runAutoUpdate({
    currentVersion: '1.0.10',
    profileDir: dir,
    writeLog: () => {},
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.12', hoursAgo: 2 }, { version: '1.0.11', hoursAgo: 30 }])),
    execFileImpl: fakeExec(calls),
    readVersionImpl: () => '1.0.11',
    nowMs: NOW,
  });
  assert.equal(out.status, 'installed');
  assert.equal(out.installer, 'pnpm');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /pnpm(\.cmd)? add dsh-pighub@1\.0\.11/, '要装成熟版 1.0.11：' + calls[0]);
  assert.ok(calls[0].indexOf(STRICT_POLICY_ARG) >= 0, '必须带一次性 strict 覆盖：' + calls[0]);
  assert.ok(calls[0].indexOf('minimumReleaseAge=0') < 0, '不许出现绕过策略的 0 窗口');
});

await acheck('pnpm 不存在（ENOENT）：退到内置 pnpm 重试一次', async () => {
  const dir = pnpmProfile();
  const calls = [];
  const installerImpl = {
    kind: 'pnpm',
    command: 'pnpm.cmd',
    argsFor: (version) => ['add', 'dsh-pighub@' + version, STRICT_POLICY_ARG],
    fallback: { kind: 'pnpm-bundled', command: 'node', argsFor: (version) => ['pnpm.mjs', 'add', 'dsh-pighub@' + version, STRICT_POLICY_ARG] },
  };
  const out = await runAutoUpdate({
    currentVersion: '1.0.10',
    profileDir: dir,
    writeLog: () => {},
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.11', hoursAgo: 30 }])),
    installerImpl,
    execFileImpl: (file, _args, _opts, cb) => {
      calls.push(file);
      cb(file === 'pnpm.cmd' ? Object.assign(new Error('spawn pnpm.cmd ENOENT'), { code: 'ENOENT' }) : null);
      return { unref() {} };
    },
    readVersionImpl: () => '1.0.11',
    nowMs: NOW,
  });
  assert.equal(calls.length, 2, '应当重试一次：' + JSON.stringify(calls));
  assert.equal(out.status, 'installed');
  assert.equal(out.installer, 'pnpm-bundled');
});

await acheck('装完回读版本对不上：报 install_unverified，不报 ok', async () => {
  const logs = [];
  const out = await runAutoUpdate({
    currentVersion: '1.0.10',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.11', hoursAgo: 30 }])),
    execFileImpl: (_f, _a, _o, cb) => { cb(null); return { unref() {} }; },
    readVersionImpl: () => '1.0.10',
    nowMs: NOW,
  });
  assert.equal(out.status, 'install_unverified');
  assert.ok(logs.some((l) => l.indexOf('unverified') >= 0 && l.indexOf('actual=1.0.10') >= 0), '日志要写明实际版本');
  assert.ok(!logs.some((l) => l.indexOf('install ok') >= 0), '没装上就不许写 ok');
});

await acheck('本地比 registry 新：ahead + 明确日志，一次安装都不发起', async () => {
  const logs = [];
  let installed = 0;
  const out = await runAutoUpdate({
    currentVersion: '1.0.10',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.6', hoursAgo: 100 }])),
    execFileImpl: () => { installed += 1; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'ahead');
  assert.equal(installed, 0);
  assert.ok(logs.some((l) => l.indexOf('check ahead') >= 0 && l.indexOf('1.0.10') >= 0), '日志要写出两边版本：' + JSON.stringify(logs));
  assert.ok(!logs.some((l) => l.indexOf('up_to_date') >= 0), '本地更新时不许写 up_to_date（1.0.11 修的就是这句谎话）');
});

await acheck('远端同版本：一次安装都不发起', async () => {
  const logs = [];
  let installed = 0;
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '0.9.61', hoursAgo: 100 }])),
    execFileImpl: () => { installed += 1; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'current');
  assert.equal(installed, 0, '同版本不许安装');
  assert.ok(logs.some((l) => l.indexOf('up_to_date') >= 0));
});

await acheck('网络失败：不抛、不安装、只记一条 offline', async () => {
  const logs = [];
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: async () => { throw new Error('ENOTFOUND'); },
    execFileImpl: () => { throw new Error('不该安装'); },
    nowMs: NOW,
  });
  assert.equal(out.status, 'offline');
  assert.equal(logs.length, 1, '只记一条，不要重试风暴');
  assert.ok(logs[0].indexOf('offline') >= 0);
});

await acheck('安装失败：静默降级为 failed，不抛出', async () => {
  const logs = [];
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '0.9.62', hoursAgo: 30 }])),
    execFileImpl: (_f, _a, _o, cb) => { cb(new Error('EACCES')); return { unref() {} }; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'failed');
  assert.ok(logs.some((l) => l.indexOf('install failed') >= 0));
});

await acheck('没有 profile 目录：不安装，记 skip', async () => {
  const logs = [];
  let installed = 0;
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: '',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '0.9.62', hoursAgo: 30 }])),
    execFileImpl: () => { installed += 1; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.reason, 'no_profile_dir');
  assert.equal(installed, 0);
});

/* ---------------- 版本地板 ---------------- */

await acheck('地板：首见记下来，回退时只装 floor 那一版', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pighub-floor-'));
  const dir = pnpmProfile();
  assert.equal(writeFloor(root, '1.0.12', { source: 'test' }), true);
  assert.equal(readFloor(root).version, '1.0.12');

  const calls = [];
  const logs = [];
  const out = await enforceFloor({
    rootDir: root,
    profileDir: dir,
    installedVersion: '1.0.10',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.12', hoursAgo: 40 }])),
    execFileImpl: fakeExec(calls),
    readVersionImpl: () => '1.0.12',
    nowMs: NOW,
  });
  assert.equal(out.status, 'repaired');
  assert.equal(out.floor, '1.0.12');
  assert.equal(out.installed, '1.0.10');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /add dsh-pighub@1\.0\.12/, '只装地板版本：' + calls[0]);
  assert.ok(logs.some((l) => l.indexOf('rollback detected') >= 0), '回退要留日志');
  assert.equal(readFloor(root).version, '1.0.12', '地板不许被回退拉低');
});

await acheck('地板：盘上比地板新时抬高地板，不安装', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pighub-floor2-'));
  writeFloor(root, '1.0.10', { source: 'test' });
  let installed = 0;
  const out = await enforceFloor({
    rootDir: root,
    profileDir: 'C:/fake/profile',
    installedVersion: '1.0.12',
    writeLog: () => {},
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.12', hoursAgo: 1 }])),
    execFileImpl: () => { installed += 1; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.raised, true);
  assert.equal(installed, 0);
  assert.equal(readFloor(root).version, '1.0.12');
});

await acheck('地板：地板版本还没过成熟期就不硬装（held_young）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pighub-floor3-'));
  writeFloor(root, '1.0.12', { source: 'test' });
  let installed = 0;
  const logs = [];
  const out = await enforceFloor({
    rootDir: root,
    profileDir: 'C:/fake/profile',
    installedVersion: '1.0.10',
    writeLog: (line) => logs.push(line),
    fetchImpl: fetchJson(packumentOf([{ version: '1.0.12', hoursAgo: 2 }])),
    execFileImpl: () => { installed += 1; },
    nowMs: NOW,
  });
  assert.equal(out.repair, 'held_young');
  assert.equal(installed, 0, '年轻的地板版本不许用绕过策略的方式装');
  assert.ok(logs.some((l) => l.indexOf('repair held') >= 0));
});

await acheck('地板：没有 profile 目录就只报告，不安装', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pighub-floor4-'));
  writeFloor(root, '1.0.12', { source: 'test' });
  let installed = 0;
  const out = await enforceFloor({
    rootDir: root,
    profileDir: '',
    installedVersion: '1.0.10',
    writeLog: () => {},
    execFileImpl: () => { installed += 1; },
    nowMs: NOW,
  });
  assert.equal(out.status, 'rollback');
  assert.equal(out.repair, 'skipped');
  assert.equal(installed, 0);
});

check('installer 选择按目录形态：npm 目录用 npm --no-save，pnpm 目录用 pnpm add + strict', () => {
  const npmDir = mkdtempSync(join(tmpdir(), 'pighub-npm-'));
  const npmInstaller = resolveInstaller(npmDir, 'win32');
  assert.equal(npmInstaller.kind, 'npm');
  assert.ok(npmInstaller.argsFor('1.0.11').indexOf('--no-save') >= 0);
  assert.ok(npmInstaller.argsFor('1.0.11').indexOf('--no-package-lock') >= 0, 'npm 路径也不许写 lockfile');

  const pnpmDir = pnpmProfile();
  const pnpmInstaller = resolveInstaller(pnpmDir, 'win32');
  assert.equal(pnpmInstaller.kind, 'pnpm');
  assert.deepEqual(pnpmInstaller.argsFor('1.0.11').slice(0, 2), ['add', 'dsh-pighub@1.0.11']);
  assert.ok(pnpmInstaller.argsFor('1.0.11').includes(STRICT_POLICY_ARG));
});

/* ---------------- 越权守卫：源码级断言，防止有人把 profile 策略又写回来 ---------------- */

check('越权守卫：自动更新的**代码**里没有「改写 profile 策略 / 绕过策略」的写法', () => {
  const raw = readFileSync(new URL('../lib/auto-update.js', import.meta.url), 'utf8');
  // 注释里会解释「为什么要禁掉这些写法」，所以先去掉注释再查 —— 查的是代码，不是文档。
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['minimumReleaseAgeExclude', 'pnpm-workspace', '.npmrc', 'minimumReleaseAge=0', '--trust-lockfile']) {
    assert.equal(code.indexOf(forbidden), -1, '代码里不该出现 ' + forbidden + '（这正是 2026-11-19 要禁掉的越权写法）');
  }
  assert.ok(code.indexOf(STRICT_POLICY_ARG) >= 0, 'strict 一次性覆盖必须在代码里');
});

check('地板文件名固定且只落在插件自己的数据目录', () => {
  assert.equal(FLOOR_FILE, 'version-floor.json');
  const root = mkdtempSync(join(tmpdir(), 'pighub-floor5-'));
  writeFloor(root, '1.0.12');
  assert.ok(readFileSync(join(root, FLOOR_FILE), 'utf8').indexOf('"1.0.12"') >= 0);
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  auto update');
process.exit(fail === 0 ? 0 : 1);
