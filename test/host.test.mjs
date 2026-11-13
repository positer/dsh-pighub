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
// 离线测试不碰原生桌宠：编译/拉起是真实副作用，测试只验 HTTP 面。
plugin.apply(ctx, { root, desktopPet: false });

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
  // 新用户开局就带一只普通猪（标准猪）
  assert.deepEqual(json.pigs.map((pig) => pig.id), ['standard-pig']);
  assert.equal(json.pigs[0].title, '普通猪');
  // 图鉴（pool）也是贴图，URL 必须带 cache-buster：素材被补全后图鉴不能继续放旧图。
  // 2026-11-13 实测：这条曾经一条都没有（256/256 都没有 ?v=），所以按「全量」断言。
  assert.equal(json.pool.length, manifest.pigs.length);
  const untagged = json.pool.filter((item) => !/\?v=[0-9a-f]{8}$/.test(item.url));
  assert.equal(untagged.length, 0, '图鉴 URL 缺 cache-buster：' + JSON.stringify(untagged.slice(0, 3)));
});

let drawn = null;
await acheck('draw：从冻结库抽一只，带本地贴图地址与活/死判定', async () => {
  const { json } = await call('POST', { action: 'draw' });
  assert.equal(json.draw.ok, true);
  drawn = json.pigs.find((pig) => pig.id === json.draw.pigId);
  assert.equal(drawn.id, json.draw.pigId);
  assert.equal(drawn.stars, 1);
  assert.ok(['live', 'dead'].indexOf(drawn.kind) >= 0);
  // 允许两层 cache-buster：内容指纹 ?v=<sha8>（素材被补全后 URL 必须变）+ 构建版本号 &v=0955
  // （store.js 的 ASSET_TAG；换版本整库失效）。两者都必须**幂等**——见下一条断言。
  assert.ok(/^\/pighub\/asset\/[a-zA-Z0-9._-]+(\?v=[0-9a-f]{8})?(&v=\d{4})?$/.test(drawn.assetUrl), '贴图应是包内路由：' + drawn.assetUrl);
  assert.equal(drawn.cut, undefined, '切分参数只属于构建期，不应进入运行时数据');
  const state = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
  assert.equal(state.todayPigId, drawn.id);
});

/* 2026-11-13 实测的缺陷：readState() 每次都调 assetUrlWithTag，writeState() 又把结果落盘，
 * 于是每读一次 URL 就多一个 v=0955——真机 state.json 里三条 URL 各带 352 个 v=0955（单条 2492 字节）。
 * 这条断言把它钉住：反复读状态，URL 不许变长。 */
await acheck('状态反复读：assetUrl 的 v= 幂等（不重复追加）', async () => {
  const first = (await call('GET')).json.pigs.map((pig) => pig.assetUrl);
  for (let i = 0; i < 3; i += 1) await call('GET');
  const later = (await call('GET')).json.pigs.map((pig) => pig.assetUrl);
  assert.deepEqual(later, first, '反复读状态后 assetUrl 变了：' + JSON.stringify({ first, later }));
  for (const url of later) assert.ok((url.match(/v=/g) || []).length <= 2, 'v= 参数被重复追加：' + url);
});

await acheck('draw 第二次（同一天）：already_drawn', async () => {
  const { json } = await call('POST', { action: 'draw' });
  assert.equal(json.draw.ok, false);
  assert.equal(json.draw.error, 'already_drawn');
  assert.equal(json.pigs.length, 2, '开局普通猪 + 抽到的 1 只');
});

await acheck('sort / prefs / pet / state 各自生效', async () => {
  assert.equal((await call('POST', { action: 'sort', sort: 'stars' })).json.sort, 'stars');
  const prefs = await call('POST', { action: 'prefs', starDisplay: 'always' });
  assert.equal(prefs.json.prefs.starDisplay, 'always');
  assert.equal(prefs.json.sort, 'stars', '只改星级不应重置排序');
  // 三态位置：猪圈 → 桌宠 → 库存，互斥
  const asPet = await call('POST', { action: 'place', pigId: drawn.id, to: 'pet' });
  assert.deepEqual(asPet.json.pets, [drawn.id]);
  assert.equal(asPet.json.pigs.find((pig) => pig.id === drawn.id).place, 'pet');
  const asStore = await call('POST', { action: 'place', pigId: drawn.id, to: 'store' });
  assert.deepEqual(asStore.json.pets, [], '进仓库后应从桌宠列表移除');
  assert.deepEqual(asStore.json.store, [drawn.id]);
  assert.equal(asStore.json.pigs.find((pig) => pig.id === drawn.id).place, 'store');
  const back = await call('POST', { action: 'place', pigId: drawn.id, to: 'pen' });
  assert.deepEqual(back.json.store, []);
  assert.equal(back.json.pigs.find((pig) => pig.id === drawn.id).place, 'pen');
  assert.equal((await call('POST', { action: 'place', pigId: 'nope', to: 'store' })).json.error, 'unknown_pig');
  // 不认识的位置现在单独报 unknown_place：客户端据此区分「猪不存在」和「位置写错了」。
  assert.equal((await call('POST', { action: 'place', pigId: drawn.id, to: 'moon' })).json.error, 'unknown_place');
  // 新动作：允许运动 / 保持静止
  const still = await call('POST', { action: 'motion', pigId: drawn.id, motion: false });
  assert.equal(still.json.ok, true);
  assert.equal(still.json.pigs.find((pig) => pig.id === drawn.id).motion, false, '静止开关要落盘');
  const moving = await call('POST', { action: 'motion', pigId: drawn.id, motion: true });
  assert.equal(moving.json.pigs.find((pig) => pig.id === drawn.id).motion, true);
  assert.equal((await call('POST', { action: 'motion', pigId: 'nope', motion: false })).json.error, 'unknown_pig');
  // 落脚点写回：进 state.json 的 pig.pos，下次打开面板从这儿接着走
  const moved = await call('POST', { action: 'position', pigId: drawn.id, x: 42.5, y: 61.25 });
  assert.equal(moved.json.ok, true);
  assert.deepEqual(moved.json.pos, { x: 42.5, y: 61.25 });
  const afterMove = await call('POST', { action: 'state' });
  assert.deepEqual(afterMove.json.pigs.find((pig) => pig.id === drawn.id).pos, { x: 42.5, y: 61.25 }, '落点应出现在快照里');
  assert.equal((await call('POST', { action: 'position', pigId: drawn.id, x: 999, y: 0 })).json.error, 'bad_position');
  assert.equal((await call('POST', { action: 'position', pigId: 'nope', x: 1, y: 1 })).json.error, 'unknown_pig');
  assert.equal((await call('POST', { action: 'state' })).json.pigs.length, 2, '开局普通猪 + 抽到的 1 只');
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
  assert.equal(answer.owned, 2, '开局普通猪 + 抽到的 1 只');
});

await acheck('没有 webServer 的宿主：只注册工具，不抛错', async () => {
  const headlessTools = new Map();
  const headless = await import(new URL('../lib/index.js', import.meta.url).href + '?headless=1');
  headless.apply({ effect: (fn) => fn(), tools: { register(def) { headlessTools.set(def.name, def); return () => {}; } }, logger: { warn() {} } }, { root: mkdtempSync(join(tmpdir(), 'pighub-headless-')) });
  assert.deepEqual([...headlessTools.keys()], ['pighub_about']);
});

/* ---- 原生桌面桌宠的契约（纯函数；不真的编译/拉起） ---- */
await acheck('桌面桌宠：只把 pets 里、素材库认得的猪翻译成原生窗口负载', async () => {
  const petModule = await import(new URL('../lib/desktop-pet.js', import.meta.url).href);
  const state = {
    pigs: {
      'pighub-974': { id: 'pighub-974', title: '斗鸡眼猪', motion: true, desktopPos: { x: 1200, y: 800 } },
      'pighub-604': { id: 'pighub-604', title: '双子猪', motion: false },
      ghost: { id: 'ghost', title: '素材里没有的猪', motion: true },
    },
    pets: ['pighub-974', 'pighub-604', 'ghost'],
  };
  const list = plugin.desktopPetsOf(state, manifest);
  assert.equal(list.length, 2, '素材库认不得的 id 不该进原生负载');
  assert.equal(list[0].id, 'pighub-974');
  assert.ok(list[0].path.endsWith('pighub-974.png'), '路径必须是包内贴图：' + list[0].path);
  assert.deepEqual([list[0].x, list[0].y], [1200, 800], '有 desktopPos 就用它');
  assert.equal(list[0].motion, true);
  assert.equal(list[1].motion, false, '运动开关要带过去');
  assert.ok(Number.isFinite(list[1].x) && Number.isFinite(list[1].y), '没有 desktopPos 也要给一个默认屏幕坐标');
  const payload = petModule.petsPayload(list, { defaultX: 100, defaultY: 200 });
  assert.equal(payload.pets.length, 2);
  for (const row of payload.pets) {
    assert.equal(typeof row.id, 'string');
    assert.equal(typeof row.path, 'string');
    assert.equal(typeof row.x, 'number');
    assert.equal(typeof row.y, 'number');
    assert.ok(row.size >= 24);
    assert.equal(typeof row.motion, 'boolean');
  }
});

await acheck('桌面桌宠：编译计划按源码哈希缓存；没有桌宠时不拉起', async () => {
  const petModule = await import(new URL('../lib/desktop-pet.js', import.meta.url).href);
  const plan = petModule.petBinaryPlan();
  assert.equal(typeof plan.hash, 'string');
  assert.equal(plan.hash.length, 20, '缓存键取 sha256 前 20 位');
  assert.ok(plan.directory.indexOf(plan.hash) >= 0, '产物目录要带哈希');
  assert.ok(plan.exe.endsWith('pighub-pet.exe'));
  assert.ok(plan.source.endsWith('.cs'));
  const args = petModule.petCompileArgs(plan);
  assert.ok(args.indexOf('/target:winexe') >= 0);
  assert.ok(args.indexOf('/platform:x64') >= 0);
  assert.ok(args.some((a) => a.startsWith('/out:')), '必须显式指定输出');
  assert.equal(args[args.length - 1], plan.source, '源文件放最后');
  const empty = await petModule.startDesktopPet([], {});
  assert.equal(empty.ok, true);
  assert.equal(petModule.desktopPetState().running, false);
});

await acheck('拖回猪圈：落点从物理像素换算成猪圈百分比（进出连续）', async () => {
  const rect = { left: 596, top: 116, width: 902, height: 902 };
  const center = plugin.penPercentFromScreen(596 + 451, 116 + 451, rect);
  assert.ok(center, '应当能换算');
  assert.ok(Math.abs(center.x - 50) < 0.6 && Math.abs(center.y - 50) < 0.6, '正中心应约等于 50%/50%，实际 ' + JSON.stringify(center));
  const topLeft = plugin.penPercentFromScreen(0, 0, rect);
  assert.equal(topLeft.x, 10, '超出左边界要夹到 10');
  assert.equal(topLeft.y, 16, '超出上边界要夹到 16');
  assert.equal(plugin.penPercentFromScreen(100, 100, null), null, '没有猪圈矩形就返回 null');
  assert.equal(plugin.penPercentFromScreen(NaN, 100, rect), null, '非法坐标返回 null');
});

rmSync(root, { recursive: true, force: true });
console.log('\n' + passed + ' PASS / 0 FAIL  —  host HTTP surface');
