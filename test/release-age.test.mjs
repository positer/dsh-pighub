#!/usr/bin/env node
/**
 * 发布年龄豁免（release-age）的判定表与落盘测试（离线）。
 *
 * 这一层只回答两个问题：
 *   ① 本插件会不会只认自己的包名，别的条目一个字都不动；
 *   ② 写文件这件事是不是幂等、原子、没有 workspace 文件时不凭空创建。
 * 「范围」不是靠注释声明的：下面用同一份文本做对照——豁免之后，另一个刚发布的包仍然不在豁免里。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RELEASE_AGE_KEY,
  SELF_PACKAGE,
  applySelfExemption,
  ensureSelfExemption,
  locateProfileDir,
  packageNameOf,
  planSelfExemption,
} from '../lib/release-age.js';

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

const FIXTURE = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: hoisted',
  'autoInstallPeers: false',
  'minimumReleaseAgeExclude:',
  '  - dsh-pighub@1.0.4 || 1.0.5 || 1.0.6',
  '  - newmark2dsh',
  '  - dsh-opencode-go@0.4.5',
  '',
].join('\n');

check('包名解析：普通、带版本、scoped 三种都要对', () => {
  assert.equal(packageNameOf('dsh-pighub'), 'dsh-pighub');
  assert.equal(packageNameOf('dsh-pighub@1.0.12'), 'dsh-pighub');
  assert.equal(packageNameOf('@scope/name@1.2.3'), '@scope/name');
  assert.equal(packageNameOf(''), '');
});

check('计划：自己的旧版本收成一条裸名，别人的条目逐字保留且顺序不变', () => {
  const plan = planSelfExemption(['dsh-pighub@1.0.4 || 1.0.5', 'newmark2dsh', 'dsh-opencode-go@0.4.5']);
  assert.deepEqual(plan.specs, ['newmark2dsh', 'dsh-opencode-go@0.4.5', 'dsh-pighub']);
  assert.deepEqual(plan.added, ['dsh-pighub']);
  assert.deepEqual(plan.removed, ['dsh-pighub@1.0.4 || 1.0.5']);
  assert.equal(planSelfExemption(plan.specs).changed, false, '再跑一遍必须没有变化');
});

check('计划：已经有裸名时保持原位置，不追加第二条', () => {
  const plan = planSelfExemption(['dsh-pighub', 'newmark2dsh']);
  assert.deepEqual(plan.specs, ['dsh-pighub', 'newmark2dsh']);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.added, []);
});

check('文本：只重写 minimumReleaseAgeExclude 一块，别的键原样保留', () => {
  const out = applySelfExemption(FIXTURE);
  assert.equal(out.changed, true);
  assert.ok(out.text.startsWith('packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'), '前缀必须逐字保留：' + JSON.stringify(out.text));
  assert.ok(out.text.includes('  - newmark2dsh'), '别的包的条目要保留');
  assert.ok(out.text.includes('  - dsh-opencode-go@0.4.5'), '别的包的条目要保留');
  assert.ok(out.text.includes('  - dsh-pighub\n'), '自己的裸条目要在');
  assert.ok(!out.text.includes('dsh-pighub@1.0.4'), '自己的旧版本条目要删掉');
});

check('文本：绝不写 minimumReleaseAge 本身（等待期是用户的决定）', () => {
  const out = applySelfExemption(FIXTURE);
  assert.equal(/^minimumReleaseAge\s*:/m.test(out.text), false);
  assert.equal(/^minimumReleaseAge\s*:/m.test(applySelfExemption('packages:\n  - .\n').text), false);
});

check('文本：幂等——第二遍逐字节相同', () => {
  const once = applySelfExemption(FIXTURE);
  const twice = applySelfExemption(once.text);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

check('文本：CRLF 保留 CRLF，行内 flow 写法也能读', () => {
  const crlf = applySelfExemption('minimumReleaseAgeExclude:\r\n  - dsh-pighub@1.0.0\r\n');
  assert.equal(crlf.text.replace(/\r\n/g, '').includes('\n'), false, '不许混进裸 \n');
  const flow = applySelfExemption('minimumReleaseAgeExclude: [dsh-pighub@1.0.0, other@2.0.0]\n');
  assert.ok(flow.text.includes('  - other@2.0.0'), 'flow 里别人的条目要保留');
  assert.ok(flow.text.includes('  - dsh-pighub\n'));
});

/* ---------------- 范围对照：另一个刚发布的包不能被我们豁免 ---------------- */

const parseExemptions = (text) => {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => new RegExp('^' + RELEASE_AGE_KEY + '\\s*:').test(line));
  if (at === -1) return [];
  const out = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const m = /^\s*-\s+(.*)$/.exec(lines[i]);
    if (!m) break;
    out.push(m[1].trim());
  }
  return out;
};
const exempts = (specs, pkg, version) => specs.some((spec) => spec === pkg
  || (spec.startsWith(pkg + '@') && spec.slice(pkg.length + 1).split('||').map((v) => v.trim()).includes(version)));

check('范围对照：我们只豁免 dsh-pighub，别人的新版本状态一点没变', () => {
  /* 对照必须用「没有别人裸名」的输入：FIXTURE 里 newmark2dsh 的裸名是**它自己**写的豁免，不是我们给的。
   * 这里只看我们的函数把什么从「不豁免」变成「豁免」。 */
  const before = ['newmark2dsh@0.3.84', 'dsh-opencode-go@0.4.5', 'dsh-pighub@1.0.4'];
  const out = applySelfExemption('minimumReleaseAgeExclude:\n' + before.map((s) => '  - ' + s).join('\n') + '\n');
  const specs = parseExemptions(out.text);
  assert.deepEqual(out.added, [SELF_PACKAGE], '我们只加自己的名字');
  assert.equal(exempts(specs, SELF_PACKAGE, '9.9.9'), true, '自己的版本被豁免（裸名）');
  assert.equal(exempts(specs, 'newmark2dsh', '0.9.9'), false, '别人的**新**版本不许被我们豁免');
  assert.equal(exempts(specs, 'dsh-opencode-go', '0.9.9'), false, '别人的**新**版本不许被我们豁免');
  assert.equal(exempts(specs, 'newmark2dsh', '0.3.84'), true, '别人原来那条按版本的豁免要原样保留');
});

check('范围对照：别人已经写好的裸名原样保留（不是我们加的）', () => {
  const out = applySelfExemption(FIXTURE);
  assert.deepEqual(out.added, [SELF_PACKAGE]);
  assert.ok(out.text.includes('  - newmark2dsh\n'), '别人写的裸名要照抄');
  assert.ok(out.text.includes('  - dsh-opencode-go@0.4.5'), '别人写的按版本条目要照抄');
});

/* ---------------- 落盘 ---------------- */

await acheck('落盘：没有 workspace 文件就如实报告，不凭空创建', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pighub-age-'));
  const answer = await ensureSelfExemption({ profileDir: dir });
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, 'no_workspace_file');
  assert.equal(existsSync(join(dir, 'pnpm-workspace.yaml')), false);
});

await acheck('落盘：写一次、再跑一次不重写，且不留下临时文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pighub-age-'));
  const file = join(dir, 'pnpm-workspace.yaml');
  writeFileSync(file, FIXTURE, 'utf8');
  const first = await ensureSelfExemption({ profileDir: dir });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.deepEqual(first.added, ['dsh-pighub']);
  const written = readFileSync(file, 'utf8');
  const second = await ensureSelfExemption({ profileDir: dir });
  assert.equal(second.changed, false);
  assert.equal(readFileSync(file, 'utf8'), written);
  assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
});

await acheck('落盘：profile 目录为空时报告 profile_dir_missing', async () => {
  const answer = await ensureSelfExemption({ profileDir: '' });
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, 'profile_dir_missing');
});

check('定位：装进 node_modules 才算 profile，源码检出不去猜', () => {
  const installed = locateProfileDir(join('C:', 'profiles', 'desktop', 'node_modules', 'dsh-pighub'));
  assert.equal(installed.ok, true);
  assert.equal(installed.dir, join('C:', 'profiles', 'desktop'));
  const source = locateProfileDir(join('C:', 'code', 'PigHub', 'dsh-pighub'));
  assert.equal(source.ok, false);
  assert.equal(source.reason, 'not_installed_under_node_modules');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  release age');
process.exit(fail === 0 ? 0 : 1);
