/**
 * store.js 的规则测试：**全部离线**，不碰网络、不碰真实的 `/.PigHub。
 *
 * 这里验证的是「规则」，不是 HTTP：
 *   - 一天一次（按本地日）；
 *   - 重复获得升星，且 firstObtainedAt 不被改写；
 *   - 三种排序稳定；
 *   - 坏文件不炸、退回空状态并留证据。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = await import(new URL('../lib/store.js', import.meta.url).href);

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };

const root = mkdtempSync(join(tmpdir(), 'pighub-store-'));
const catalog = {
  fetchedAt: '2026-11-12T00:00:00.000Z',
  count: 3,
  images: [
    { id: '1', title: '甲猪', filename: 'a.jpg', imageUrl: 'https://pighub.top/images/a.jpg' },
    { id: '2', title: '乙猪', filename: 'b.jpg', imageUrl: 'https://pighub.top/images/b.jpg' },
    { id: '3', title: '丙猪', filename: 'c.jpg', imageUrl: 'https://pighub.top/images/c.jpg' },
  ],
};

check('localDate 输出本地日 YYYY-MM-DD', () => {
  assert.equal(mod.localDate(new Date(2026, 10, 12, 23, 59, 59)), '2026-11-12');
  assert.equal(mod.localDate(new Date(2026, 0, 1, 0, 0, 1)), '2026-01-01');
});

check('第一次抽取：1 星，首次=最近升星', () => {
  const state = mod.emptyState();
  const r = mod.draw(state, catalog, { now: new Date(2026, 10, 12, 9, 0, 0), rng: () => 0 });
  assert.equal(r.ok, true);
  assert.equal(r.upgraded, false);
  const pig = state.pigs['1'];
  assert.equal(pig.stars, 1);
  assert.equal(pig.firstObtainedAt, pig.lastUpgradedAt);
  assert.equal(state.lastDrawDate, '2026-11-12');
  assert.equal(state.todayPigId, '1');
});

check('同一天再抽：already_drawn，且不消耗随机数', () => {
  const state = mod.emptyState();
  mod.draw(state, catalog, { now: new Date(2026, 10, 12, 9, 0, 0), rng: () => 0 });
  let drew = 0;
  const r = mod.draw(state, catalog, { now: new Date(2026, 10, 12, 23, 0, 0), rng: () => { drew += 1; return 0.5; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'already_drawn');
  assert.equal(r.today.pigId, '1');
  assert.equal(drew, 0, '拒绝时不应调用 rng');
  assert.equal(state.draws, 1);
});

check('隔天抽到同一只：升 1 星，首次时间不被改写，最近升星时间更新', () => {
  const state = mod.emptyState();
  const first = new Date(2026, 10, 12, 9, 0, 0);
  mod.draw(state, catalog, { now: first, rng: () => 0 });
  const second = new Date(2026, 10, 13, 10, 30, 0);
  const r = mod.draw(state, catalog, { now: second, rng: () => 0 });
  assert.equal(r.ok, true);
  assert.equal(r.upgraded, true);
  const pig = state.pigs['1'];
  assert.equal(pig.stars, 2);
  assert.equal(pig.firstObtainedAt, first.toISOString());
  assert.equal(pig.lastUpgradedAt, second.toISOString());
  assert.deepEqual(pig.drawDates, ['2026-11-12', '2026-11-13']);
  assert.equal(state.draws, 2);
});

check('目录为空：抽不到，不写状态', () => {
  const state = mod.emptyState();
  const r = mod.draw(state, { images: [] }, { now: new Date(2026, 10, 12) });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'catalog_empty');
  assert.equal(state.draws, 0);
});

check('随机索引落在边界内（rng 返回 1 时取最后一只，不越界）', () => {
  const state = mod.emptyState();
  const r = mod.draw(state, catalog, { now: new Date(2026, 10, 12), rng: () => 1 });
  assert.equal(r.ok, true);
  assert.equal(r.pig.id, '3');
});

check('新手开局：新状态自带一只普通猪（标准猪）', () => {
  const state = mod.emptyState();
  const pig = state.pigs[mod.STANDARD_PIG_ID];
  assert.ok(pig, '新状态必须含标准猪');
  assert.equal(pig.title, '普通猪');
  assert.equal(pig.rarity, 'common');
  assert.equal(pig.stars, 1);
  assert.equal(mod.placeOf(state, mod.STANDARD_PIG_ID), 'pen', '开局就应该在猪圈里');
});

check('三种排序：主键不同、平手时退回获得时间倒序', () => {
  const state = mod.emptyState();
  // 排序断言只关心抽到的三只，先把开局的普通猪摘掉
  delete state.pigs[mod.STANDARD_PIG_ID];
  mod.draw(state, catalog, { now: new Date(2026, 10, 12, 8, 0, 0), rng: () => 0 });        // id 1, 首次 11-12
  mod.draw(state, catalog, { now: new Date(2026, 10, 13, 8, 0, 0), rng: () => 0.34 });     // id 2, 首次 11-13
  mod.draw(state, catalog, { now: new Date(2026, 10, 14, 8, 0, 0), rng: () => 0.99 });     // id 3, 首次 11-14
  assert.deepEqual(mod.listPigs(state, 'time').map((p) => p.id), ['3', '2', '1'], '获取时间倒序');
  // 全部 1 星 ⇒ stars 排序退到获得时间倒序，与 time 相同
  assert.deepEqual(mod.listPigs(state, 'stars').map((p) => p.id), ['3', '2', '1'], '同星退到获得时间');
  // 给 id 1 升到 2 星：stars 排序里它必须排第一，其余按获得时间倒序
  mod.draw(state, catalog, { now: new Date(2026, 10, 15, 8, 0, 0), rng: () => 0 });        // id 1 再次，升 2 星
  assert.equal(state.pigs['1'].stars, 2);
  assert.deepEqual(mod.listPigs(state, 'stars').map((p) => p.id), ['1', '3', '2'], '星级优先，平手按获得时间');
  // 稀有度全同 ⇒ 依次退到星级、获得时间，故与 stars 顺序一致
  assert.deepEqual(mod.listPigs(state, 'rarity').map((p) => p.id), ['1', '3', '2'], '稀有度全同时退到星级');
  // time 排序只看 firstObtainedAt，升星不改变首次获得时间 ⇒ AI 顺序不变
  assert.deepEqual(mod.listPigs(state, 'time').map((p) => p.id), ['3', '2', '1'], '升星不改首次获得时间');
  // 稳定性：同样输入两次调用结果一致
  assert.deepEqual(mod.listPigs(state, 'stars').map((p) => p.id), ['1', '3', '2']);
});

check('稀有度：上游无数据 ⇒ 全部 common，并带出中文标签', () => {
  const state = mod.emptyState();
  mod.draw(state, catalog, { now: new Date(2026, 10, 12), rng: () => 0 });
  const [row] = mod.listPigs(state, 'time');
  assert.equal(row.rarity, 'common');
  assert.equal(row.rarityLabel, '普通');
});

check('读写 state：能落盘并能读回', () => {
  const state = mod.emptyState();
  mod.draw(state, catalog, { now: new Date(2026, 10, 12), rng: () => 0 });
  mod.writeState(root, state);
  assert.ok(existsSync(join(root, 'state.json')));
  const again = mod.readState(root);
  assert.equal(again.draws, 1);
  // 抽到 1 只 + 开局自带的普通猪 = 2
  assert.equal(Object.keys(again.pigs).length, 2);
  assert.ok(again.pigs[mod.STANDARD_PIG_ID], '普通猪要一直在');
});

check('坏 state.json：退回空状态，并把原文改名保留', () => {
  const badRoot = mkdtempSync(join(tmpdir(), 'pighub-bad-'));
  writeFileSync(join(badRoot, 'state.json'), '{ this is not json', 'utf8');
  const state = mod.readState(badRoot);
  // 退回的是「新用户状态」：自带一只普通猪
  assert.equal(Object.keys(state.pigs).length, 1, '退回空状态（含开局普通猪）');
  assert.ok(state.pigs[mod.STANDARD_PIG_ID], '开局普通猪仍在');
  assert.ok(state.note, '把解析失败的原因留在 note 上');
  assert.equal(existsSync(join(badRoot, 'state.json')), false, '原文件已被改名');
  const leftovers = readdirSync(badRoot).filter((name) => name.startsWith('state.json.corrupt-'));
  assert.equal(leftovers.length, 1, '留下恰好一个 .corrupt 备份');
  assert.equal(readFileSync(join(badRoot, leftovers[0]), 'utf8'), '{ this is not json', '备份内容与原文一致');
  rmSync(badRoot, { recursive: true, force: true });
});

check('猪圈容量 12：第 13 只自动进仓库，并回 capped', () => {
  const state = mod.emptyState();
  // 容量测试要干净的猪圈：把开局普通猪摘掉
  delete state.pigs[mod.STANDARD_PIG_ID];
  for (let i = 1; i <= 12; i += 1) {
    state.pigs['p' + i] = { id: 'p' + i, title: '猪' + i, kind: 'live', motion: true, stars: 1, firstObtainedAt: '2026-11-12T00:00:00.000Z', lastUpgradedAt: '2026-11-12T00:00:00.000Z' };
  }
  assert.equal(mod.penCount(state), 12);
  // 第 12 只放回猪圈：仍然接受
  assert.equal(mod.place(state, 'p1', 'pen').capped, false);
  state.pigs.p13 = { id: 'p13', title: '猪13', kind: 'live', motion: true, stars: 1 };
  const moved = mod.place(state, 'p13', 'pen');
  assert.equal(moved.ok, true);
  assert.equal(moved.capped, true, '猪圈已满 12 只时应标记 capped');
  assert.equal(moved.to, 'store', '超出的猪要落到仓库');
  assert.ok(state.store.indexOf('p13') >= 0);
  assert.equal(mod.placeOf(state, 'p13'), 'store');
});

check('抽到猪时猪圈已满：新猪直接进仓库', () => {
  const state = mod.emptyState();
  for (let i = 1; i <= 12; i += 1) {
    state.pigs['q' + i] = { id: 'q' + i, title: '猪' + i, kind: 'live', motion: true, stars: 1 };
  }
  const r = mod.draw(state, catalog, { now: new Date(2026, 10, 12), rng: () => 0 });
  assert.equal(r.ok, true);
  assert.equal(r.capped, true, '抽到的猪应带 capped 标记');
  assert.ok(state.store.indexOf(r.pig.id) >= 0, '新猪应进仓库');
  assert.equal(mod.placeOf(state, r.pig.id), 'store');
});

check('落脚点：写回 state 且越界/非数字一律拒收', () => {
  const state = mod.emptyState();
  state.pigs.y = { id: 'y', title: '某猪', kind: 'live', motion: true, stars: 1 };
  assert.equal(mod.setPosition(state, 'y', 30, 40).ok, true);
  assert.deepEqual(state.pigs.y.pos, { x: 30, y: 40 });
  assert.equal(mod.setPosition(state, 'y', -5, 40).ok, false, '越界要被拒');
  assert.equal(mod.setPosition(state, 'y', 30, 140).ok, false, '越界要被拒');
  assert.equal(mod.setPosition(state, 'y', 'abc', 10).ok, false, '非数字要被拒');
  assert.deepEqual(state.pigs.y.pos, { x: 30, y: 40 }, '被拒的写入不能改掉旧落点');
  assert.equal(mod.setPosition(state, 'nope', 1, 1).ok, false);
});

check('运动开关：显式布尔可写、null 回到素材默认、落在 state 里', () => {
  const state = mod.emptyState();
  state.pigs.x = { id: 'x', title: '某猪', kind: 'live', motion: true, stars: 1 };
  assert.equal(mod.setMotion(state, 'x', false).ok, true);
  assert.equal(state.pigs.x.motion, false);
  assert.equal(mod.setMotion(state, 'x', true).motion, true);
  assert.equal(mod.setMotion(state, 'x', null).ok, true);
  assert.equal('motion' in state.pigs.x, false, 'null 表示清掉覆盖');
  assert.equal(mod.setMotion(state, 'nope', false).ok, false);
});

check('prefs：排序与星级显示各自独立，非法值退回默认', () => {
  assert.deepEqual(mod.writePrefs(root, { sort: 'stars' }), { sort: 'stars', starDisplay: 'hover' });
  assert.equal(mod.readPrefs(root).sort, 'stars');
  assert.equal(mod.writePrefs(root, { sort: 'nonsense' }).sort, 'time');
  // 只改星级显示，不能把排序重置掉（反之亦然）
  assert.deepEqual(mod.writePrefs(root, { starDisplay: 'always' }), { sort: 'time', starDisplay: 'always' });
  assert.deepEqual(mod.writePrefs(root, { sort: 'rarity' }), { sort: 'rarity', starDisplay: 'always' });
  assert.equal(mod.writePrefs(root, { starDisplay: 'nope' }).starDisplay, 'hover');
});


