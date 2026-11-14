#!/usr/bin/env node
/** 主题包准入闸门 + 归一化的离线用例（用户口径 2026-11-14：不合法主题要拒绝）。 */
import assert from 'node:assert/strict';
import { validateThemePack, normaliseTheme, CLASSIC_GEOMETRY } from '../lib/themes.js';

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' :: ' + (e && e.message)); } };
const rejects = (meta, files, prefix, expect) => {
  const r = validateThemePack(meta, files, prefix || '');
  assert.equal(r.ok, false, '应当拒绝：' + JSON.stringify(meta));
  assert.ok(r.reason.indexOf(expect) === 0, '原因应为 ' + expect + '，实际 ' + r.reason);
};
const img = [{ name: 'fence.png', data: Buffer.alloc(1) }];
const meta = [{ name: 'theme.json', data: Buffer.alloc(1) }];

check('主题名非法 → 拒绝', () => rejects({ name: '../x' }, img.concat(meta), '', 'theme_name_invalid'));
check('主题名保留字 classic → 拒绝', () => rejects({ name: 'classic' }, img.concat(meta), '', 'theme_name_reserved'));
check('geometry 非 4 数字 → 拒绝', () => rejects({ name: 'a', geometry: { grass: [1, 2, 3] } }, img.concat(meta), '', 'geometry_invalid'));
check('geometry left≥right → 拒绝', () => rejects({ name: 'a', geometry: { grass: [80, 20, 10, 90] } }, img.concat(meta), '', 'geometry_inverted'));
check('geometry 越界 → 拒绝', () => rejects({ name: 'a', geometry: { grass: [-5, 20, 80, 90] } }, img.concat(meta), '', 'geometry_out_of_range'));
check('既无图片又无 geometry → 拒绝', () => rejects({ name: 'a' }, meta, '', 'theme_has_nothing'));
check('fence.image 不在包里 → 拒绝', () => rejects({ name: 'a', fence: { image: 'nope.png' } }, img.concat(meta), '', 'fence_image_missing'));
check('包里混入非 json/图片 → 拒绝', () => rejects({ name: 'a' }, img.concat(meta, [{ name: 'run.exe', data: Buffer.alloc(1) }]), '', 'unexpected_file'));
check('合法包 → 通过且名字取自 theme.json', () => {
  const r = validateThemePack({ name: 'ok', geometry: { grass: [10, 20, 90, 95] } }, img.concat(meta), '');
  assert.equal(r.ok, true); assert.equal(r.name, 'ok');
});
check('normaliseTheme 对坏 geometry 逐字段回落 classic', () => {
  const t2 = normaliseTheme({ name: 'x', geometry: { grass: 'bad', inner: [1, 2, 3, 4] } }, 'x');
  assert.deepEqual(t2.geometry.grass, CLASSIC_GEOMETRY.grass);
  assert.deepEqual(t2.geometry.inner, [1, 2, 3, 4]);
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  themes');
process.exit(fail === 0 ? 0 : 1);