#!/usr/bin/env node
/**
 * 静默自动更新的分支测试（离线，不联网、不装包）。
 *
 * 1.0.11 起多钉三条，全部来自 2026-11-18 的那次事故：
 *   · 本地比 registry 新时必须报 ahead，不许再写成 up_to_date（那行日志会把「有未发布修复」说成「没事」）；
 *   · pnpm 管理的 profile 必须用 pnpm 装，不许在 pnpm 树上跑 npm install（会改写 spec、和 lock 打架）；
 *   · 命令 exit 0 不算装上，回读版本对不上就要报 install_unverified。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareSemver, runAutoUpdate, resolveInstaller } from '../lib/auto-update.js';

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

const jsonRes = (version) => async () => ({ ok: true, json: async () => ({ version }) });

check('版本比较是语义化的（0.9.9 < 0.9.10，不能按字符串比）', () => {
  assert.equal(compareSemver('0.9.9', '0.9.10'), -1);
  assert.equal(compareSemver('0.9.10', '0.9.9'), 1);
  assert.equal(compareSemver('0.9.61', '0.9.61'), 0);
  assert.equal(compareSemver('v0.9.61', '0.9.61'), 0);
  assert.equal(compareSemver('1.0.0', '0.9.99'), 1);
  assert.equal(compareSemver('0.9', '0.9.0'), 0);
});

await acheck('远端更高：发起一次安装，回读对上才算 installed', async () => {
  const logs = [];
  const calls = [];
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: jsonRes('0.9.62'),
    execFileImpl: (file, args, _opts, cb) => { calls.push(file + ' ' + args.join(' ')); cb(null); return { unref() {} }; },
    readVersionImpl: () => '0.9.62',
  });
  assert.equal(out.status, 'installed');
  assert.equal(out.installedVersion, '0.9.62');
  assert.equal(calls.length, 1, '应当恰好安装一次');
  assert.ok(calls[0].indexOf('dsh-pighub@0.9.62') >= 0, '安装目标版本要正确：' + calls[0]);
  assert.ok(calls[0].indexOf('--no-save') >= 0, 'npm 目录必须带 --no-save，不能改写用户 spec：' + calls[0]);
  assert.ok(logs.some((l) => l.indexOf('install start') >= 0), '要有 start 日志');
  assert.ok(logs.some((l) => l.indexOf('install ok') >= 0 && l.indexOf('verified=') >= 0), 'ok 日志要带回读版本');
});

await acheck('pnpm 管理的 profile：用 pnpm add，不用 npm', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pighub-pnpm-'));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const calls = [];
  const out = await runAutoUpdate({
    currentVersion: '1.0.10',
    profileDir: dir,
    writeLog: () => {},
    fetchImpl: jsonRes('1.0.11'),
    execFileImpl: (file, args, _opts, cb) => { calls.push(file + ' ' + args.join(' ')); cb(null); return { unref() {} }; },
    readVersionImpl: () => '1.0.11',
  });
  assert.equal(out.status, 'installed');
  assert.equal(out.installer, 'pnpm');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /pnpm(\.cmd)? add dsh-pighub@1\.0\.11/, '必须是 pnpm add：' + calls[0]);
  assert.ok(calls[0].indexOf('--no-save') < 0, 'pnpm 路径不该混进 npm 的参数');
});

await acheck('pnpm 不存在（ENOENT）：退到内置 pnpm 重试一次', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pighub-pnpm2-'));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const calls = [];
  const installerImpl = {
    kind: 'pnpm',
    command: 'pnpm.cmd',
    argsFor: (version) => ['add', 'dsh-pighub@' + version],
    fallback: { kind: 'pnpm-bundled', command: 'node', argsFor: (version) => ['pnpm.mjs', 'add', 'dsh-pighub@' + version] },
  };
  const out = await runAutoUpdate({
    currentVersion: '1.0.10',
    profileDir: dir,
    writeLog: () => {},
    fetchImpl: jsonRes('1.0.11'),
    installerImpl,
    execFileImpl: (file, args, _opts, cb) => {
      calls.push(file);
      const error = file === 'pnpm.cmd' ? Object.assign(new Error('spawn pnpm.cmd ENOENT'), { code: 'ENOENT' }) : null;
      cb(error);
      return { unref() {} };
    },
    readVersionImpl: () => '1.0.11',
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
    fetchImpl: jsonRes('1.0.11'),
    execFileImpl: (_f, _a, _o, cb) => { cb(null); return { unref() {} }; },
    readVersionImpl: () => '1.0.10',
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
    fetchImpl: jsonRes('1.0.6'),
    execFileImpl: () => { installed += 1; },
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
    fetchImpl: jsonRes('0.9.61'),
    execFileImpl: () => { installed += 1; },
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
    fetchImpl: jsonRes('0.9.62'),
    execFileImpl: (_f, _a, _o, cb) => { cb(new Error('EACCES')); return { unref() {} }; },
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
    fetchImpl: jsonRes('0.9.62'),
    execFileImpl: () => { installed += 1; },
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.reason, 'no_profile_dir');
  assert.equal(installed, 0);
});

check('installer 选择按目录形态：npm 目录用 npm --no-save，pnpm 目录用 pnpm add', () => {
  const npmDir = mkdtempSync(join(tmpdir(), 'pighub-npm-'));
  const npmInstaller = resolveInstaller(npmDir, 'win32');
  assert.equal(npmInstaller.kind, 'npm');
  assert.ok(npmInstaller.argsFor('1.0.11').indexOf('--no-save') >= 0);

  const pnpmDir = mkdtempSync(join(tmpdir(), 'pighub-pnpm3-'));
  writeFileSync(join(pnpmDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const pnpmInstaller = resolveInstaller(pnpmDir, 'win32');
  assert.equal(pnpmInstaller.kind, 'pnpm');
  assert.deepEqual(pnpmInstaller.argsFor('1.0.11').slice(0, 2), ['add', 'dsh-pighub@1.0.11']);
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  auto update');
process.exit(fail === 0 ? 0 : 1);
