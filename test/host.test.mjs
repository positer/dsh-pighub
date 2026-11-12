/**
 * Host 半的 HTTP 面测试：**不启动 DSH、不联网**。
 *
 * 用假的 ctx 捕获注册结果（工具 + 路由），用假的 req/res 走一遍 /pighub 的五个动作
 * 与三条错误路径。上游用假的 fetch 顶替——这不影响结论，因为本插件对上游只有一次
 * 「GET 一个 JSON」的依赖，而它已经被 store 的归一化测试覆盖。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'pighub-host-'));
const payload = {
  code: 0,
  message: 'OK',
  data: [
    { id: 3, title: '丙猪', filename: 'c.jpg', image_url: '/images/c.jpg' },
    { id: 2, title: '乙猪', filename: 'b.jpg', image_url: '/images/b.jpg' },
    { id: 1, title: '甲猪', filename: 'a.jpg', image_url: '/images/a.jpg' },
  ],
};

let fetchCalls = 0;
let failFetch = false;
const IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
let imageType = 'image/jpeg';
let imageFails = false;

/** 目录两个来源 + 图片代理，都按 URL 分流，避免「一个 stub 供应所有请求」掩盖真实路径。 */
globalThis.fetch = async (url) => {
  fetchCalls += 1;
  if (failFetch) throw new Error('network_down');
  const href = String(url);
  if (href.indexOf('api.github.com') >= 0) {
    return { ok: true, status: 200, json: async () => [
      { name: '甲乙猪.jpg', type: 'file', download_url: 'https://raw.githubusercontent.com/x/data/%E7%94%B2%E4%B9%99%E7%8C%AA.jpg' },
      { name: '丙猪.jpg', type: 'file', download_url: 'https://raw.githubusercontent.com/x/data/%E4%B8%99%E7%8C%AA.jpg' },
      { name: 'README.md', type: 'file', download_url: 'https://raw.githubusercontent.com/x/README.md' },
      { name: 'subdir', type: 'dir' },
    ] };
  }
  if (href.indexOf('/images/') >= 0 || href.indexOf('raw.githubusercontent.com') >= 0) {
    if (imageFails) return { ok: false, status: 404, headers: { get: () => null }, body: null };
    return {
      ok: true, status: 200,
      headers: { get: (key) => (key.toLowerCase() === 'content-length' ? String(IMAGE_BYTES.length) : key.toLowerCase() === 'content-type' ? imageType : null) },
      body: (async function* () { yield IMAGE_BYTES; })(),
    };
  }
  return { ok: true, status: 200, json: async () => payload };
};

/* ---- 假的宿主上下文 ---- */
const tools = new Map();
const routes = new Map();
const ctx = {
  effect(fn) { return fn(); },
  tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  logger: { warn() {} },
};

const plugin = await import(new URL('../lib/index.js', import.meta.url).href);
plugin.apply(ctx, { root });
await new Promise((r) => setTimeout(r, 50)); // 让启动预热的那次 fetch 落地

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };
const acheck = async (label, fn) => { await fn(); passed += 1; console.log('PASS  ' + label); };

function makeReq(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body), 'utf8');
    },
  };
}
function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(text) { this.body = text; },
  };
}
async function call(method, body) {
  const route = routes.get('/pighub');
  assert.ok(route, '路由未注册');
  const res = makeRes();
  await route.handler(makeReq(method, body), res);
  return { status: res.status, headers: res.headers, json: JSON.parse(res.body || '{}') };
}

check('注册了 pighub_about 工具、状态路由与图片代理', () => {
  assert.ok(tools.has('pighub_about'));
  assert.deepEqual([...routes.keys()].sort(), ['/pighub', '/pighub/image']);
  assert.equal(routes.get('/pighub').kind, 'exact');
  assert.equal(routes.get('/pighub/image').kind, 'exact');
  assert.deepEqual(plugin.inject, ['tools'], '只注入 tools：webServer 缺失时不能让整个 profile 启动失败');
});

await acheck('GET 返回快照：两个来源合并后的目录，今日未抽，偏好随快照下发', async () => {
  const { status, headers, json } = await call('GET');
  assert.equal(status, 200);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(json.ok, true);
  // 实时目录（候选池）：主接口 3 只 + 开源镜像 2 只（README.md 与目录被过滤）
  assert.equal(json.catalog.count, 5);
  // 抽猪池是冻结库：6 只，其中活 2 / 死 4
  assert.equal(json.assets.total, 6);
  assert.equal(json.assets.live, 2);
  assert.equal(json.assets.dead, 4);
  assert.equal(json.assets.version, '2026.11.12');
  const sources = json.catalog.sources;
  assert.deepEqual(sources.map((s) => s.id).sort(), ['pighub', 'pighub-db']);
  assert.ok(sources.every((s) => s.ok), '两个来源都应成功');
  assert.deepEqual(sources.map((s) => s.count).sort(), [2, 3]);
  assert.equal(json.today.drawn, false);
  assert.deepEqual(json.pigs, []);
  assert.equal(json.sort, 'time');
  assert.deepEqual(json.prefs, { sort: 'time', starDisplay: 'hover' }, '默认星级显示是 hover');
  assert.equal(json.root, root);
});

let drawnId = '';
await acheck('draw：抽到一只，1 星，写盘', async () => {
  const { status, json } = await call('POST', { action: 'draw' });
  assert.equal(status, 200);
  assert.equal(json.draw.ok, true);
  assert.equal(json.draw.stars, 1);
  assert.equal(json.draw.upgraded, false);
  assert.ok(['live', 'dead'].indexOf(json.pigs[0].kind) >= 0, '抽到的猪必须带活/死判定');
  assert.ok(json.pigs[0].cut && Array.isArray(json.pigs[0].cut.trim), '抽到的猪必须带切分参数');
  drawnId = json.draw.pigId;
  assert.equal(json.today.drawn, true);
  assert.equal(json.pigs.length, 1);
  assert.equal(json.pigs[0].id, drawnId);
  assert.ok(existsSync(join(root, 'state.json')), 'state.json 已落盘');
  const state = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
  assert.equal(state.todayPigId, drawnId);
  assert.equal(state.draws, 1);
});

await acheck('draw 第二次（同一天）：already_drawn，不重复入账', async () => {
  const before = fetchCalls;
  const { json } = await call('POST', { action: 'draw' });
  assert.equal(json.draw.ok, false);
  assert.equal(json.draw.error, 'already_drawn');
  assert.equal(json.pigs.length, 1);
  assert.equal(json.catalog.count, 5);
  assert.equal(fetchCalls, before, '同一天被拒时不重新拉目录（缓存仍在 TTL 内）');
});

await acheck('sort：写入 prefs.json 并回传新顺序', async () => {
  const { json } = await call('POST', { action: 'sort', sort: 'stars' });
  assert.equal(json.sort, 'stars');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'prefs.json'), 'utf8')), { sort: 'stars', starDisplay: 'hover' });
});

await acheck('pet：把已拥有的猪标记为桌宠，再取消', async () => {
  const on = await call('POST', { action: 'pet', pigId: drawnId, pet: true });
  assert.deepEqual(on.json.pets, [drawnId]);
  const off = await call('POST', { action: 'pet', pigId: drawnId, pet: false });
  assert.deepEqual(off.json.pets, []);
  const unknown = await call('POST', { action: 'pet', pigId: 'no-such-pig', pet: true });
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.error, 'unknown_pig');
});

await acheck('state 动作与 GET 等价', async () => {
  const { json } = await call('POST', { action: 'state' });
  assert.equal(json.ok, true);
  assert.equal(json.pigs.length, 1);
});

await acheck('未知动作 → 400 unknown_action', async () => {
  const { status, json } = await call('POST', { action: 'nope' });
  assert.equal(status, 400);
  assert.equal(json.error, 'unknown_action');
});

await acheck('不支持的 HTTP 方法 → 405', async () => {
  const { status, json } = await call('PUT');
  assert.equal(status, 405);
  assert.equal(json.error, 'method_not_allowed');
});

await acheck('上游不可用：refresh 仍回 200，带 error 与旧缓存', async () => {
  failFetch = true;
  const { status, json } = await call('POST', { action: 'refresh' });
  assert.equal(status, 200);
  assert.equal(json.ok, true, '路由本身没坏');
  assert.ok(json.catalog.error, '快照里带着上游失败原因');
  assert.equal(json.catalog.count, 5, '退回旧缓存，面板仍能渲染');
  failFetch = false;
});

await acheck('坏请求体：JSON 解析失败 → 500 且不结束进程', async () => {
  const route = routes.get('/pighub');
  const res = makeRes();
  const badReq = { method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from('{not json'); } };
  await route.handler(badReq, res); // 不抛异常即为通过
  assert.equal(res.status, 500);
  assert.ok(JSON.parse(res.body).error);
});

await acheck('工具 pighub_about：报告数据目录与拥有数量', async () => {
  const answer = await tools.get('pighub_about').execute({}, {});
  assert.equal(answer.plugin, 'dsh-pighub');
  assert.equal(answer.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, '版本必须与 package.json 一致');
  assert.equal(answer.root, root);
  assert.equal(answer.owned, 1);
  assert.equal(answer.today.drawn, true);
  assert.equal(answer.catalog.count, 5);
});

await acheck('prefs：星级显示三档可写可读，非法值退回默认', async () => {
  const set = await call('POST', { action: 'prefs', starDisplay: 'always' });
  assert.equal(set.json.prefs.starDisplay, 'always');
  assert.equal(set.json.sort, 'stars', '只改一个偏好时不应把排序重置');
  const file = JSON.parse(readFileSync(join(root, 'prefs.json'), 'utf8'));
  assert.deepEqual(file, { sort: 'stars', starDisplay: 'always' });
  const bad = await call('POST', { action: 'prefs', starDisplay: 'nonsense' });
  assert.equal(bad.json.prefs.starDisplay, 'hover', '非法值退回默认 hover');
  for (const mode of ['off', 'hover', 'always']) {
    const r = await call('POST', { action: 'prefs', starDisplay: mode });
    assert.equal(r.json.prefs.starDisplay, mode, '应接受 ' + mode);
  }
  await call('POST', { action: 'prefs', starDisplay: 'hover' });
});

async function callImage(query) {
  const route = routes.get('/pighub/image');
  const res = makeRes();
  const req = { method: 'GET', url: '/pighub/image' + query };
  await route.handler(req, res);
  return res;
}

await acheck('图片代理：放行白名单主机并按字节透传', async () => {
  const res = await callImage('?src=' + encodeURIComponent('https://pighub.top/images/a.jpg'));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.equal(res.headers['content-length'], String(IMAGE_BYTES.length));
  assert.equal(res.headers['cache-control'], 'private, max-age=86400');
  assert.deepEqual(Buffer.from(res.body), IMAGE_BYTES, '字节必须与上游一致');
});

await acheck('图片代理：缺参 / 非 https / 非白名单主机 全部拒绝', async () => {
  assert.equal((await callImage('')).status, 400);
  assert.equal((await callImage('?src=not-a-url')).status, 400);
  assert.equal((await callImage('?src=' + encodeURIComponent('http://pighub.top/images/a.jpg'))).status, 400, '只接受 https');
  const blocked = await callImage('?src=' + encodeURIComponent('https://evil.example/a.jpg'));
  assert.equal(blocked.status, 403, '不在白名单的主机必须拒绝（否则就是 SSRF 跳板）');
  assert.equal(JSON.parse(blocked.body).error, 'host_not_allowed');
  const loopback = await callImage('?src=' + encodeURIComponent('https://127.0.0.1/a.jpg'));
  assert.equal(loopback.status, 403);
});

await acheck('图片代理：上游 404 / 非图片类型 分别映射为 502 与 415', async () => {
  imageFails = true;
  const failed = await callImage('?src=' + encodeURIComponent('https://pighub.top/images/a.jpg'));
  assert.equal(failed.status, 502);
  imageFails = false;
  imageType = 'text/html';
  const wrong = await callImage('?src=' + encodeURIComponent('https://raw.githubusercontent.com/x/a.jpg'));
  assert.equal(wrong.status, 415);
  assert.equal(JSON.parse(wrong.body).error, 'not_an_image');
  imageType = 'image/jpeg';
});

await acheck('没有 webServer 的宿主：只注册工具，不抛错（无头 profile 不会被拖垮）', async () => {
  const headlessTools = new Map();
  let routeRegistered = false;
  const headlessCtx = {
    effect: (fn) => fn(),
    tools: { register(def) { headlessTools.set(def.name, def); return () => {}; } },
    logger: { warn() {} },
    // 刻意不提供 webServer，也不提供 ctx.get
  };
  const headless = await import(new URL('../lib/index.js', import.meta.url).href + '?headless=1');
  headless.apply(headlessCtx, { root: mkdtempSync(join(tmpdir(), 'pighub-headless-')) });
  assert.deepEqual([...headlessTools.keys()], ['pighub_about'], '工具照常注册');
  assert.equal(routeRegistered, false);
});

rmSync(root, { recursive: true, force: true });
console.log('\n' + passed + ' PASS / 0 FAIL  —  host HTTP surface');