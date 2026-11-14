#!/usr/bin/env node
/**
 * 静默自动更新的三分支测试（离线，不联网、不装包）：
 *   高版本 → 发起安装并写日志 / 同版本 → 不动作 / 网络失败 → 不抛且只记一条。
 * 依赖注入让这三条都能在本地跑出来。
 */
import assert from 'node:assert/strict';
import { compareSemver, runAutoUpdate } from '../lib/auto-update.js';

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log('PASS  ' + name);
  } catch (error) {
    fail += 1;
    console.log('FAIL  ' + name + ' :: ' + (error && error.message));
  }
};
const acheck = async (name, fn) => {
  try {
    await fn();
    pass += 1;
    console.log('PASS  ' + name);
  } catch (error) {
    fail += 1;
    console.log('FAIL  ' + name + ' :: ' + (error && error.message));
  }
};

check('版本比较是语义化的（0.9.9 < 0.9.10，不能按字符串比）', () => {
  assert.equal(compareSemver('0.9.9', '0.9.10'), -1);
  assert.equal(compareSemver('0.9.10', '0.9.9'), 1);
  assert.equal(compareSemver('0.9.61', '0.9.61'), 0);
  assert.equal(compareSemver('v0.9.61', '0.9.61'), 0);
  assert.equal(compareSemver('1.0.0', '0.9.99'), 1);
  assert.equal(compareSemver('0.9', '0.9.0'), 0);
});

await acheck('远端更高：发起一次安装，并在日志里写下 start/ok', async () => {
  const logs = [];
  const calls = [];
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.9.62' }) }),
    execFileImpl: (_file, args, _opts, cb) => { calls.push(args.join(' ')); cb(null); return { unref() {} }; },
  });
  assert.equal(out.status, 'installed');
  assert.equal(calls.length, 1, '应当恰好安装一次');
  assert.ok(calls[0].indexOf('dsh-pighub@0.9.62') >= 0, '安装目标版本要正确：' + calls[0]);
  assert.ok(logs.some((l) => l.indexOf('install start') >= 0), '要有 start 日志');
  assert.ok(logs.some((l) => l.indexOf('install ok') >= 0), '要有 ok 日志');
});

await acheck('远端同版本：一次安装都不发起', async () => {
  const logs = [];
  let installed = 0;
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: (line) => logs.push(line),
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.9.61' }) }),
    execFileImpl: () => { installed += 1; },
  });
  assert.equal(out.status, 'current');
  assert.equal(installed, 0, '同版本不许安装');
  assert.ok(logs.some((l) => l.indexOf('up_to_date') >= 0));
});

await acheck('远端更老：也不安装（只升不降）', async () => {
  let installed = 0;
  const out = await runAutoUpdate({
    currentVersion: '0.9.61',
    profileDir: 'C:/fake/profile',
    writeLog: () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.9.10' }) }),
    execFileImpl: () => { installed += 1; },
  });
  assert.equal(out.status, 'current');
  assert.equal(installed, 0);
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
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.9.62' }) }),
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
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.9.62' }) }),
    execFileImpl: () => { installed += 1; },
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.reason, 'no_profile_dir');
  assert.equal(installed, 0);
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  auto update');
process.exit(fail === 0 ? 0 : 1);
