/**
 * Host 半的 HTTP 面测试：**不启动 DSH、不联网**。
 *
 * 素材已随包分发，所以这里没有任何上游请求：状态路由 + 每张素材一条 exact 静态路由。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'pighub-host-'));
const plugin = await import(new URL('../lib/index.js', import.meta.url).href);
const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));

const tools = new Map();
const routes = new Map();
const ctx = {
  effect(fn) { return fn(); },
  tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  logger: { warn() {} },
};
plugin.apply(ctx, { root });

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };
const acheck = async (label, fn) => { await fn(); passed += 1; console.log('PASS  ' + label); };

function makeReq(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body), 'utf8'); },
  };
}
function makeRes() {
  return { status: 0, headers: null, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = text; } };
}
async function call(method, body) {
  const route = routes.get('/pighub');
  assert.ok(route, '状态路由未注册');
  const res = makeRes();
  await route.handler(makeReq(method, body), res);
  return { status: res.status, headers: res.headers, json: JSON.parse(res.body || '{}') };
}

check('注册了工具、状态路由与每张素材的静态路由', () => {
  assert.ok(tools.has('pighub_about'));
  assert.ok(routes.has('/pighub'));
  const assetRoutes = [...routes.keys()].filter((path) => path.startsWith('/pighub/asset/'));
  assert.equal(assetRoutes.length, manifest.pigs.length, '每张素材应有一条路由，实际 ' + assetRoutes.length);
  assert.deepEqual(plugin.inject, ['tools'], '只注入 tools：webServer 缺失时不能让整个 profile 启动失败');
});

await acheck('GET 快照：素材库随包、今日未抽、偏好默认值', async () => {
  const { status, headers, json } = await call('GET');
  assert.equal(status, 200);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(json.ok, true);
  assert.equal(json.assets.total, manifest.pigs.length);
  assert.equal(json.assets.version, manifest.assetVersion);
  assert.ok(json.assets.bytes > 0, '素材体积应可统计');
  assert.equal(json.catalog, undefined, '运行时不再有上游目录');
  assert.deepEqual(json.prefs, { sort: 'time', starDisplay: 'hover' });
  assert.equal(json.today.drawn, false);
  assert.deepEqual(json.pigs, []);
});

let drawn = null;
await acheck('draw：从冻结库抽一只，带本地贴图地址与活/死判定', async () => {
  const { json } = await call('POST', { action: 'draw' });
  assert.equal(json.draw.ok, true);
  drawn = json.pigs[0];
  assert.equal(drawn.id, json.draw.pigId);
  assert.equal(drawn.stars, 1);
  assert.ok(['live', 'dead'].indexOf(drawn.kind) >= 0);
  assert.ok(/^\/pighub\/asset\/[a-zA-Z0-9._-]+$/.test(drawn.assetUrl), '贴图应是包内路由：' + drawn.assetUrl);
  assert.equal(drawn.cut, undefined, '切分参数只属于构建期，不应进入运行时数据');
  const state = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
  assert.equal(state.todayPigId, drawn.id);
});

await acheck('draw 第二次（同一天）：already_drawn', async () => {
  const { json } = await call('POST', { action: 'draw' });
  assert.equal(json.draw.ok, false);
  assert.equal(json.draw.error, 'already_drawn');
  assert.equal(json.pigs.length, 1);
});

await acheck('sort / prefs / pet / state 各自生效', async () => {
  assert.equal((await call('POST', { action: 'sort', sort: 'stars' })).json.sort, 'stars');
  const prefs = await call('POST', { action: 'prefs', starDisplay: 'always' });
  assert.equal(prefs.json.prefs.starDisplay, 'always');
  assert.equal(prefs.json.sort, 'stars', '只改星级不应重置排序');
  // 三态位置：猪圈 → 桌宠 → 库存，互斥
  const asPet = await call('POST', { action: 'place', pigId: drawn.id, to: 'pet' });
  assert.deepEqual(asPet.json.pets, [drawn.id]);
  assert.equal(asPet.json.pigs[0].place, 'pet');
  const asStore = await call('POST', { action: 'place', pigId: drawn.id, to: 'store' });
  assert.deepEqual(asStore.json.pets, [], '进仓库后应从桌宠列表移除');
  assert.deepEqual(asStore.json.store, [drawn.id]);
  assert.equal(asStore.json.pigs[0].place, 'store');
  const back = await call('POST', { action: 'place', pigId: drawn.id, to: 'pen' });
  assert.deepEqual(back.json.store, []);
  assert.equal(back.json.pigs[0].place, 'pen');
  assert.equal((await call('POST', { action: 'place', pigId: 'nope', to: 'store' })).json.error, 'unknown_pig');
  assert.equal((await call('POST', { action: 'place', pigId: drawn.id, to: 'moon' })).json.error, 'unknown_pig');
  assert.equal((await call('POST', { action: 'state' })).json.pigs.length, 1);
});

await acheck('错误路径：未知动作 400、方法 405、坏请求体 500', async () => {
  assert.equal((await call('POST', { action: 'nope' })).status, 400);
  assert.equal((await call('PUT')).status, 405);
  const route = routes.get('/pighub');
  const res = makeRes();
  await route.handler({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from('{not json'); } }, res);
  assert.equal(res.status, 500);
});

await acheck('素材路由：能取到字节、类型正确、且拒绝非 GET', async () => {
  const pig = manifest.pigs[0];
  const route = routes.get('/pighub/asset/' + pig.file.split('/').pop());
  assert.ok(route, '缺少素材路由');
  const res = makeRes();
  await route.handler({ method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.ok(/^image\/(png|svg\+xml|gif)$/.test(res.headers['content-type']), '类型：' + res.headers['content-type']);
  assert.ok(Buffer.byteLength(res.body) > 100, '应返回真实字节');
  const bad = makeRes();
  await route.handler({ method: 'POST' }, bad);
  assert.equal(bad.status, 405);
});

await acheck('工具 pighub_about：报告版本、素材摘要与本地贴图清单', async () => {
  const answer = await tools.get('pighub_about').execute({}, {});
  assert.equal(answer.plugin, 'dsh-pighub');
  assert.equal(answer.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(answer.assets.total, manifest.pigs.length);
  assert.ok(answer.assets.bytes > 0);
  assert.ok(answer.pool.every((pig) => pig.url.startsWith('/pighub/asset/')), '池子里每只都应指向本地贴图');
  assert.ok(answer.dataPolicy.indexOf('不访问素材库') > 0);
  assert.equal(answer.owned, 1);
});

await acheck('没有 webServer 的宿主：只注册工具，不抛错', async () => {
  const headlessTools = new Map();
  const headless = await import(new URL('../lib/index.js', import.meta.url).href + '?headless=1');
  headless.apply({ effect: (fn) => fn(), tools: { register(def) { headlessTools.set(def.name, def); return () => {}; } }, logger: { warn() {} } }, { root: mkdtempSync(join(tmpdir(), 'pighub-headless-')) });
  assert.deepEqual([...headlessTools.keys()], ['pighub_about']);
});

rmSync(root, { recursive: true, force: true });
console.log('\n' + passed + ' PASS / 0 FAIL  —  host HTTP surface');
