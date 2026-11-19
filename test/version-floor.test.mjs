#!/usr/bin/env node
/**
 * 版本地板（版本回退锁）的存储与判定测试。
 *
 * 这一层只答一个问题：「这台机器上跑过的最高版本是哪一版？」
 * 落盘在 ~/.PigHub/version-floor.json，**不碰 profile** —— 该碰 profile 的那一半（安装）在
 * auto-update.js 的 enforceFloor，由它决定「只装 floor 那一版」。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FLOOR_FILE, floorFilePath, observeVersion, readFloor, writeFloor } from '../lib/version-floor.js';

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass += 1; console.log('PASS  ' + name); }
  catch (error) { fail += 1; console.log('FAIL  ' + name + ' :: ' + (error && error.message)); }
};

const dir = () => mkdtempSync(join(tmpdir(), 'pighub-floor-'));

check('没有地板文件时返回 null（不是抛错）', () => {
  assert.equal(readFloor(dir()), null);
});

check('首见一个版本就记成地板', () => {
  const root = dir();
  const out = observeVersion(root, '1.0.12', { nowMs: Date.parse('2026-11-19T03:00:00Z') });
  assert.equal(out.floor, '1.0.12');
  assert.equal(out.raised, true);
  assert.equal(out.rollback, false);
  const stored = readFloor(root);
  assert.equal(stored.version, '1.0.12');
  assert.equal(stored.updatedAt, '2026-11-19T03:00:00.000Z');
});

check('更高版本抬高地板；同版本重复观察不写盘', () => {
  const root = dir();
  observeVersion(root, '1.0.10');
  const first = readFileSync(floorFilePath(root), 'utf8');
  const raised = observeVersion(root, '1.0.12');
  assert.equal(raised.raised, true);
  assert.equal(raised.floor, '1.0.12');
  const before = readFileSync(floorFilePath(root), 'utf8');
  const same = observeVersion(root, '1.0.12');
  assert.equal(same.raised, false);
  assert.equal(same.rollback, false);
  assert.equal(readFileSync(floorFilePath(root), 'utf8'), before, '同版本不该重写文件');
  assert.notEqual(first, before);
});

check('更低版本判为回退，且**不**把地板拉低', () => {
  const root = dir();
  observeVersion(root, '1.0.12');
  const out = observeVersion(root, '1.0.10');
  assert.equal(out.rollback, true);
  assert.equal(out.floor, '1.0.12');
  assert.equal(readFloor(root).version, '1.0.12', '地板只升不降');
});

check('坏 JSON / 非法版本号都当作「还没记过」', () => {
  const root = dir();
  writeFileSync(join(root, FLOOR_FILE), '{not json', 'utf8');
  assert.equal(readFloor(root), null);
  assert.equal(observeVersion(root, '1.0.12').raised, true, '坏文件不妨碍重新记录');

  const root2 = dir();
  writeFileSync(join(root2, FLOOR_FILE), JSON.stringify({ version: 'latest' }), 'utf8');
  assert.equal(readFloor(root2), null);
});

check('writeFloor 拒绝非法版本号，且落盘是完整的 JSON', () => {
  const root = dir();
  assert.equal(writeFloor(root, 'latest'), false);
  assert.equal(writeFloor(root, '1.0.12', { source: 'test' }), true);
  const parsed = JSON.parse(readFileSync(floorFilePath(root), 'utf8'));
  assert.equal(parsed.version, '1.0.12');
  assert.equal(parsed.source, 'test');
  assert.match(parsed.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

check('数据目录不存在时也能落盘（mkdir 递归）', () => {
  const root = join(dir(), 'nested', 'data');
  assert.equal(writeFloor(root, '1.0.12'), true);
  assert.equal(readFloor(root).version, '1.0.12');
});

check('预发布后缀不影响比较（1.0.12-rc.1 与 1.0.12 同版）', () => {
  const root = dir();
  observeVersion(root, '1.0.12');
  const out = observeVersion(root, '1.0.12-rc.1');
  assert.equal(out.rollback, false);
  assert.equal(out.floor, '1.0.12');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  version floor');
process.exit(fail === 0 ? 0 : 1);
