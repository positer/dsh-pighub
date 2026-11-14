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
  // 猪圈布景（木栅栏）走单独一条前缀：它不是素材库的一部分，不能混进上面那条「每只猪一条路由」。
  const penRoutes = [...routes.keys()].filter((path) => path.startsWith('/pighub/pen/'));
  assert.deepEqual(penRoutes, ['/pighub/pen/pen-fence.png'], '木栅栏应有且只有一条静态路由，实际 ' + JSON.stringify(penRoutes));
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
  // prefs 现在多一个 theme（主题包，用户口径 2026-11-14）；未设置时必须是 classic
  assert.deepEqual(json.prefs, { sort: 'time', starDisplay: 'hover', theme: 'classic' });
  assert.ok(Array.isArray(json.themes) && json.themes.length >= 1, '快照要带主题列表');
  assert.equal(json.themes[0].name, 'classic', '内置 classic 永远排第一');
  assert.equal(json.today.drawn, false);
  // 新用户开局就带一只普通猪（标准猪）
  assert.deepEqual(json.pigs.map((pig) => pig.id), ['standard-pig']);
  assert.equal(json.pigs[0].title, '普通猪');
  // 图鉴（pool）也是贴图，URL 必须带 cache-buster：素材被补全后图鉴不能继续放旧图。
  // 2026-11-13 实测：这条曾经一条都没有（256/256 都没有 ?v=），所以按「全量」断言。
  assert.equal(json.pool.length, manifest.pigs.length);
  const untagged = json.pool.filter((item) => !/\?v=[0-9a-f]{8}$/.test(item.url));
  assert.equal(untagged.length, 0, '图鉴 URL 缺 cache-buster：' + JSON.stringify(untagged.slice(0, 3)));
  // 描述（manifest 的 note，逐图判定理由）必须下发：抽卡演出要在卡片上显示「名字 + 描述」。
  // 2026-11-14 之前 pigs[] / pool[] / today.pig 三处都没有这个字段，客户端拿不到这串字。
  assert.equal(json.pool.filter((item) => typeof item.note !== 'string').length, 0, '图鉴条目缺 note 字段');
  const noted = json.pool.filter((item) => item.note.length >= 6);
  assert.equal(noted.length, manifest.pigs.filter((pig) => String(pig.note || '').length >= 6).length,
    'pool 的 note 应与 manifest 逐条一致（不是空串糊过去）');
  assert.equal(json.pigs.filter((pig) => typeof pig.note !== 'string').length, 0, '已拥有的猪缺 note 字段');
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
  // 抽到的那只（pigs[] 里的记录）也要带描述：演出卡片是从 pigs[] 取名字与描述的。
  const asset = manifest.pigs.find((pig) => pig.id === drawn.id);
  assert.equal(typeof drawn.note, 'string', '抽到的猪缺 note，演出的描述会是空的');
  assert.equal(drawn.note, String((asset && asset.note) || ''), 'pigs[] 的 note 必须就是 manifest 那一条');
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

/*
 * rev 令牌（2026-11-14）：桌宠在桌面上时浏览器半每 250 ms 问一次，所以它必须
 * ①小（不回快照）、②只在渲染相关状态真的变了时才变（否则 250 ms 就把整张快照拉一遍）、
 * ③place/pos 一变就必须变（否则「双击回圈后猪圈里空着」那 8 秒会原样复活）。
 */
await acheck('rev 令牌：小、空闲不变、place/pos 一变就变', async () => {
  const first = await call('POST', { action: 'rev' });
  assert.equal(first.status, 200);
  assert.equal(typeof first.json.rev, 'string');
  assert.ok(first.json.rev.length > 0, '令牌不能是空串');
  assert.ok(first.json.rev.length < 200, '令牌必须小（实测 ' + first.json.rev.length + ' 字符），否则 250 ms 轮询毫无意义');
  // 只回令牌：不许夹带快照（图鉴 256 条就是 38 KB）
  assert.deepEqual(Object.keys(first.json).sort(), ['ok', 'rev']);

  const idle = await call('POST', { action: 'rev' });
  assert.equal(idle.json.rev, first.json.rev, '没人动状态时令牌必须稳定（否则每 250 ms 拉一次整张快照）');

  // 位置**故意不进令牌**：猪圈里每只猪每 ~1.7 s 写一次 pos，进令牌就等于每 1.7 s 拉一张 38 KB 的快照。
  // 位置由客户端自己写、并由 10 s 的整张快照兜底（与改动前一致）。
  const position = await call('POST', { action: 'position', pigId: drawn.id, x: 33, y: 44 });
  assert.equal(position.json.ok, true);
  const afterPos = await call('POST', { action: 'rev' });
  assert.equal(afterPos.json.rev, first.json.rev, '只改位置不该让令牌变（否则整张快照会被位置写回拖着跑）');
  const motion = await call('POST', { action: 'motion', pigId: drawn.id, motion: false });
  assert.equal(motion.json.ok, true);
  const afterMotion = await call('POST', { action: 'rev' });
  assert.notEqual(afterMotion.json.rev, afterPos.json.rev, '运动开关必须让令牌变（右键切运动是宿主侧改的）');

  const placed = await call('POST', { action: 'place', pigId: drawn.id, to: 'pet' });
  assert.deepEqual(placed.json.pets, [drawn.id]);
  const afterPlace = await call('POST', { action: 'rev' });
  assert.notEqual(afterPlace.json.rev, afterPos.json.rev, 'place 必须让令牌变：这就是「回圈后猪圈空着」的通道');
  // place 回来的那一半：同一个动作反向再走一次，令牌还要再变一次（不是只认"变过一次"）
  await call('POST', { action: 'place', pigId: drawn.id, to: 'pen' });
  assert.notEqual((await call('POST', { action: 'rev' })).json.rev, afterPlace.json.rev);
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

await acheck('木栅栏路由：客户端写死的那条路径必须真有路由，且字节与包内文件逐字节相同', async () => {
  // 客户端把围栏路径写成常量（PEN_FENCE_URL），宿主按 PEN_ART 注册。两边对不上就是一张空白猪圈，
  // 所以这里从**客户端的源码**里抠出那条路径来查路由——而不是把字符串抄一遍。
  const clientSrc = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const m = clientSrc.match(/const PEN_FENCE_URL = '([^']+)'/);
  assert.ok(m, 'client.js 里找不到 PEN_FENCE_URL');
  const url = m[1];
  const route = routes.get(url);
  assert.ok(route, '客户端引用的 ' + url + ' 没有对应的路由');
  const res = makeRes();
  await route.handler({ method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png', '围栏必须是 PNG：' + res.headers['content-type']);
  assert.equal(res.headers['cache-control'], 'private, no-cache, must-revalidate', '围栏图也要回源校验');
  const onDisk = readFileSync(new URL('../assets/img/pen-fence.png', import.meta.url));
  assert.equal(Buffer.byteLength(res.body), onDisk.length, '路由返回的字节数与包内文件不同');
  assert.ok(onDisk.equals(Buffer.from(res.body)), '路由返回的字节与包内文件不同（围栏被改写过了？）');
  // 非 GET 一律 405，和素材路由同一套规矩
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

/* ---- pig-say：桌宠气泡（离线：不编译、不拉起原生窗口） ---- */
await acheck('pig-say：已注册，text 必填、schema 封闭、声明 output', async () => {
  const tool = tools.get('pig-say');
  assert.ok(tool, '没有注册 pig-say');
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters.required, ['text']);
  assert.equal(tool.parameters.properties.text.type, 'string');
  assert.equal(tool.parameters.additionalProperties, false);
  assert.ok(tool.description.length > 40);
  assert.ok(tool.description.indexOf('no_desktop_pet') > 0, '禁止把"没有桌宠"写成异常而不写进描述');
  assert.equal(tool.output.schema.type, 'object');
  assert.equal(typeof tool.output.render, 'function');
  const blocks = tool.output.render({}, { ok: false, error: 'no_desktop_pet' });
  assert.ok(Array.isArray(blocks) && blocks[0].type === 'text');
});

check('clampSayText：200 字上限、按码点截断、非字符串当空', () => {
  const cut = plugin.clampSayText('猪'.repeat(250));
  assert.equal(cut.truncated, true);
  assert.equal(Array.from(cut.text).length, 200);
  assert.equal(cut.length, 250);
  assert.deepEqual(plugin.clampSayText('猪猪来了'), { text: '猪猪来了', truncated: false, length: 4 });
  // 代理对不许切一半：201 个 emoji 截成 200 个**完整**的
  const emoji = plugin.clampSayText('🐷'.repeat(201));
  assert.equal(emoji.truncated, true);
  assert.equal(emoji.text, '🐷'.repeat(200));
  assert.equal(plugin.clampSayText(undefined).text, '');
  assert.equal(plugin.clampSayText(42).text, '');
  assert.equal(plugin.clampSayText('   ').text, '');
});

check('pickSayPet：只从给的那批里挑；多只时随机且不越界', () => {
  assert.equal(plugin.pickSayPet([]), '');
  assert.equal(plugin.pickSayPet(null), '');
  assert.equal(plugin.pickSayPet(['a']), 'a');
  assert.equal(plugin.pickSayPet(['a', 'b'], () => 0), 'a');
  assert.equal(plugin.pickSayPet(['a', 'b'], () => 0.999), 'b');
  assert.equal(plugin.pickSayPet(['a', 'b'], () => 1), 'b', '随机数取 1 也不许越界');
});

await acheck('pig-say：没有桌宠时返回 no_desktop_pet（拒绝，不是异常）', async () => {
  const empty = await import(new URL('../lib/index.js', import.meta.url).href + '?say-nopet=1');
  const emptyTools = new Map();
  const emptyRoot = mkdtempSync(join(tmpdir(), 'pighub-say-empty-'));
  empty.apply({
    effect: (fn) => fn(),
    tools: { register(def) { emptyTools.set(def.name, def); return () => {}; } },
    logger: { warn() {} },
  }, { root: emptyRoot, desktopPet: false });
  const answer = await emptyTools.get('pig-say').execute({ text: '在吗' });
  assert.deepEqual(answer, { ok: false, error: 'no_desktop_pet', message: '当前没有桌宠猪猪，先把猪猪放到桌宠' });
  // 空文本比"有没有猪"更早被拒：连桌宠都不问
  assert.equal((await emptyTools.get('pig-say').execute({ text: '   ' })).error, 'empty_text');
  rmSync(emptyRoot, { recursive: true, force: true });
});

await acheck('pig-say：有桌宠但原生窗口没起来 → desktop_pet_unavailable（不谎报成功）', async () => {
  // 本测试的 ctx 用 desktopPet:false，所以永远没有原生窗口；验的是"不起来说不起来"。
  await call('POST', { action: 'place', pigId: 'standard-pig', to: 'pet' });
  const answer = await tools.get('pig-say').execute({ text: '在吗' });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, 'desktop_pet_unavailable');
  assert.ok(answer.message.indexOf('桌面桌宠') >= 0, answer.message);
  await call('POST', { action: 'place', pigId: 'standard-pig', to: 'pen' });
});

await acheck('commands.jsonl：say 行的格式即契约（原生 LoadSay 按它解析）', async () => {
  const petModule = await import(new URL('../lib/desktop-pet.js', import.meta.url).href);
  const dir = mkdtempSync(join(tmpdir(), 'pighub-say-cmd-'));
  const until = 1794586086391;
  const line = petModule.sayCommandLine('pighub-604', '猪猪来了', until);
  assert.equal(line.endsWith('\n'), true, 'jsonl：每行以换行收尾');
  assert.deepEqual(JSON.parse(line), { type: 'say', id: 'pighub-604', text: '猪猪来了', until });
  assert.equal(petModule.writeSayCommand(dir, 'pighub-604', '第一句', until).ok, true);
  petModule.writeSayCommand(dir, 'pighub-604', '第二句', until + 6000);
  const rows = readFileSync(join(dir, 'commands.jsonl'), 'utf8').split('\n').filter(Boolean).map((row) => JSON.parse(row));
  assert.equal(rows.length, 2, '两条 say 各占一行');
  assert.equal(rows[1].text, '第二句');
  assert.equal(rows.every((row) => row.type === 'say' && typeof row.until === 'number' && typeof row.id === 'string'), true);
  assert.equal(petModule.writeSayCommand('', 'x', 'y', 1).code, 'no_directory');
  rmSync(dir, { recursive: true, force: true });
});

await acheck('sayOnDesktop：没有在跑的原生窗口 → not_running（拒绝，不抛）', async () => {
  const petModule = await import(new URL('../lib/desktop-pet.js', import.meta.url).href);
  assert.deepEqual(petModule.sayOnDesktop('standard-pig', '在吗'), { ok: false, code: 'not_running' });
});

await acheck('没有 webServer 的宿主：只注册工具，不抛错', async () => {
  const headlessTools = new Map();
  const headless = await import(new URL('../lib/index.js', import.meta.url).href + '?headless=1');
  headless.apply({ effect: (fn) => fn(), tools: { register(def) { headlessTools.set(def.name, def); return () => {}; } }, logger: { warn() {} } }, { root: mkdtempSync(join(tmpdir(), 'pighub-headless-')) });
  assert.deepEqual([...headlessTools.keys()], ['pighub_about', 'pig-say']);
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
  // 桌宠是 Windows 原生窗口：非 win32 平台上产物名没有 .exe，且编译参数也不同。
  // CI 跑在 ubuntu-latest 上，这里必须按平台断言，否则 pack 任务会红、发布流水线直接停摆。
  assert.ok(/pighub-pet(\.exe)?$/.test(plan.exe), '产物名应带 pighub-pet（win32 上是 .exe）：' + plan.exe);
  assert.ok(plan.source.endsWith('.cs'));
  const args = petModule.petCompileArgs(plan);
  if (process.platform === 'win32') {
    assert.ok(args.indexOf('/target:winexe') >= 0);
    assert.ok(args.indexOf('/platform:x64') >= 0);
  } else {
    // 非 Windows 上不编译原生窗口：只要编译参数是个数组即可（CI 在 ubuntu-latest 上跑 pack）
    assert.ok(Array.isArray(args));
  }
  assert.ok(args.some((a) => a.startsWith('/out:')), '必须显式指定输出');
  assert.equal(args[args.length - 1], plan.source, '源文件放最后');
  const empty = await petModule.startDesktopPet([], {});
  // 桌宠是 Windows 原生窗口：只有 win32 上「没有桌宠」才算成功空操作；
  // 其他平台（CI 的 ubuntu-latest）必须如实报 false，而不是假装拉起来了。
  if (process.platform === 'win32') assert.equal(empty.ok, true);
  else assert.equal(empty.ok, false, '非 Windows 上不应声称拉起了原生窗口');
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
