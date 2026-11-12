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
  source: mod.CATALOG_SOURCE,
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

check('三种排序：主键不同、平手时退回获得时间倒序', () => {
  const state = mod.emptyState();
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
  assert.equal(Object.keys(again.pigs).length, 1);
});

check('坏 state.json：退回空状态，并把原文改名保留', () => {
  const badRoot = mkdtempSync(join(tmpdir(), 'pighub-bad-'));
  writeFileSync(join(badRoot, 'state.json'), '{ this is not json', 'utf8');
  const state = mod.readState(badRoot);
  assert.equal(Object.keys(state.pigs).length, 0, '退回空状态');
  assert.ok(state.note, '把解析失败的原因留在 note 上');
  assert.equal(existsSync(join(badRoot, 'state.json')), false, '原文件已被改名');
  const leftovers = readdirSync(badRoot).filter((name) => name.startsWith('state.json.corrupt-'));
  assert.equal(leftovers.length, 1, '留下恰好一个 .corrupt 备份');
  assert.equal(readFileSync(join(badRoot, leftovers[0]), 'utf8'), '{ this is not json', '备份内容与原文一致');
  rmSync(badRoot, { recursive: true, force: true });
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

check('catalog：归一去重 + 图片 URL 只拼不下载', () => {
  const payload = { code: 0, data: [
    { id: 2, title: '乙', filename: 'b.jpg', image_url: '/images/b.jpg' },
    { id: 2, title: '重复', filename: 'b2.jpg' },
    { id: 1, title: '甲', filename: 'a b.jpg' },
  ] };
  const c = mod.normaliseCatalog(payload, '2026-11-12T00:00:00.000Z');
  assert.equal(c.count, 2);
  assert.equal(c.images[0].imageUrl, 'https://pighub.top/images/b.jpg');
  assert.equal(c.images[1].imageUrl, 'https://pighub.top/images/a%20b.jpg');
});

check('catalogIsStale：缺/过期/未来时间都算过期', () => {
  assert.equal(mod.catalogIsStale(null), true);
  assert.equal(mod.catalogIsStale({ fetchedAt: new Date().toISOString() }, Date.now(), 60000), false);
  assert.equal(mod.catalogIsStale({ fetchedAt: '2000-01-01T00:00:00.000Z' }, Date.now(), 60000), true);
  assert.equal(mod.catalogIsStale({ fetchedAt: '2999-01-01T00:00:00.000Z' }, Date.now(), 60000), true);
});

rmSync(root, { recursive: true, force: true });
console.log('\n' + passed + ' PASS / 0 FAIL  —  store rules');
