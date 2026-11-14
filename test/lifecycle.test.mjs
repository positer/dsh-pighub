/**
 * 生命周期（Cordis 停止契约）测试：**不起桌宠、不碰线上实例**。
 *
 * 这里只测三件能离线断言的事：
 *   1. `stopDesktopPet()` 是**可等待**的（返回 Promise，没有会话时立刻 settle）；
 *   2. 重复停止是**幂等**的（连点两次不报错、不重复做事）；
 *   3. 宿主被强杀后的**启动自愈**（`reclaimStaleSessions`）只清"宿主已经不在"的会话，
 *      对"宿主还活着"的会话（另一个 DSH 实例）与没有 pid 记录的新目录一律不动。
 *
 * 为什么这一层需要单独的测试：真实停止要起原生进程，只能在真机上量（见
 * `archive/cordis-stop-compat.md`）；但"disposer 是不是可等待的""重复调用会不会炸"
 * 是纯结构问题，回归时必须能在 CI 里跑出来。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pet = await import(new URL('../lib/desktop-pet.js', import.meta.url).href);

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };
const acheck = async (label, fn) => { await fn(); passed += 1; console.log('PASS  ' + label); };

const isWin = process.platform === 'win32';

await acheck('stopDesktopPet 没有会话时立刻 settle，且明确回 already_stopped', async () => {
  const pending = pet.stopDesktopPet('test');
  assert.equal(typeof pending.then, 'function', 'disposer 必须可等待：Cordis 会 await 它');
  const startedAt = Date.now();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.already_stopped, true);
  assert.ok(Date.now() - startedAt < 200, '没有会话时不该有等待，实测 ' + (Date.now() - startedAt) + 'ms');
});

await acheck('连续两次停止是幂等的（连点两次 disable 不报错）', async () => {
  const first = await pet.stopDesktopPet('test-1');
  const second = await pet.stopDesktopPet('test-2');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.already_stopped, true);
});

check('desktopPetState() 的形状：没有会话时 running=false，并暴露 stopping', () => {
  const state = pet.desktopPetState();
  assert.equal(state.running, false);
  assert.equal(typeof state.stopping, 'boolean');
});

if (!isWin) {
  console.log('SKIP  启动自愈只在 win32 上有意义（' + process.platform + '）');
} else {
  await acheck('启动自愈：宿主已死的会话被清掉，宿主还活着的会话原样保留', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pighub-reclaim-'));
    // 一个"还活着"的宿主：本测试自己拉起的 node 进程，pid 真实存在。
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore', windowsHide: true });
    try {
      const aliveDir = join(root, 'session-alive');
      const deadDir = join(root, 'session-dead');
      const bareDir = join(root, 'session-bare');
      mkdirSync(aliveDir, { recursive: true });
      mkdirSync(deadDir, { recursive: true });
      mkdirSync(bareDir, { recursive: true });
      // pid 故意取一个不会存在的 pet pid：不在 tasklist 的 pighub-pet.exe 列表里，自愈不会去 kill 它。
      writeFileSync(join(aliveDir, 'pid'), JSON.stringify({ pid: 999996, hostPid: owner.pid, exe: 'x.exe', startedAt: Date.now() }));
      writeFileSync(join(deadDir, 'pid'), JSON.stringify({ pid: 999997, hostPid: 999998, exe: 'x.exe', startedAt: Date.now() }));

      const swept = await pet.reclaimStaleSessions({ root });
      const reclaimed = swept.reclaimed.map((row) => row.pid);
      const kept = swept.kept.map((row) => row.why);
      assert.deepEqual(reclaimed, [999997], '应当且只应当清掉宿主已死的那个会话');
      assert.equal(swept.reclaimed[0].killed, false, '不是 pighub-pet.exe 的 pid 一律不杀');
      assert.ok(kept.indexOf('owner_alive') >= 0, '宿主还活着的会话必须保留（另一个 DSH 实例）');
      assert.ok(kept.indexOf('no_pid') >= 0, '没有 pid 记录的新目录不许动');
      assert.equal(existsSync(deadDir), false, '宿主已死的会话目录应被删除');
      assert.equal(existsSync(aliveDir), true);
      assert.equal(existsSync(bareDir), true);
    } finally {
      try { owner.kill(); } catch { /* 已经退出 */ }
      try { rmSync(root, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
  });
}

console.log('\n' + passed + ' PASS / 0 FAIL  —  lifecycle (Cordis stop contract)');
