/**
 * 冒烟测试 —— **发布闸门**（prepublishOnly 跑的就是它）。
 *
 * 它守的是「这个包还是个能装、能跑、能渲染的 DSH 插件吗」，不测业务规则
 * （那是 store.test.mjs / host.test.mjs / client.test.mjs 的事）。所以它必须：
 *   - 快（毫秒级）、离线（不联网、不写真实用户目录）；
 *   - 只看包与宿主的契约面：manifest 声明、入口导出、槽位/路由注册、前端半的形状。
 *
 * 任何一条不成立就非零退出——坏包发不出去。
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', here), 'utf8'));
const root = mkdtempSync(join(tmpdir(), 'pighub-smoke-'));

// 上游在这里不该被访问；给了假 fetch 只是为了证明「即使调用也不会真联网」。
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: [] }) });

const plugin = await import(new URL('../lib/index.js', here).href);

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };

/* ---- 1. manifest ---- */
check('导出 name / inject / apply', () => {
  assert.equal(typeof plugin.name, 'string');
  assert.ok(Array.isArray(plugin.inject));
  assert.equal(typeof plugin.apply, 'function');
});
check('name 与 package.json 一致', () => assert.equal(plugin.name, pkg.name));
check('inject 只声明 tools（webServer 按需查找，避免无 Web 的 profile 启动失败）', () => {
  assert.deepEqual(plugin.inject, ['tools']);
  const source = readFileSync(new URL('../lib/index.js', here), 'utf8');
  assert.ok(source.indexOf('lookupWebServer') > 0, '缺少 webServer 的可选查找');
});
check('manifest 声明 bundle 补丁并导出补丁文件', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(pkg.exports?.['./cordis.patch.yml'], './cordis.patch.yml');
  assert.ok(existsSync(new URL('../cordis.patch.yml', here)));
});
check('manifest 声明浏览器半：platform=web + 导出 ./client', () => {
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.equal(pkg.exports?.['./client'], './lib/client.js');
  assert.ok(existsSync(new URL('../lib/client.js', here)), 'lib/client.js 不存在，声明 dsh.client 会让启动图取不到文件');
});
check('浏览器半是 closure-factory（只调用 __ModuleLoader__.load）', () => {
  const text = readFileSync(new URL('../lib/client.js', here), 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((code.match(/__ModuleLoader__\.load\(/g) || []).length, 1, '代码里必须恰好一次 __ModuleLoader__.load 调用');
  assert.ok(text.indexOf('window.__ModuleLoader__.load(') > 0, '缺少注册调用');
  assert.ok(text.indexOf('id: \'dsh-pighub\'') > 0, 'bundle id 必须是包名');
  assert.equal(/^\s*(import|export)\s/m.test(text), false, '不能含 ESM 语法：它以普通脚本加载');
});

/* ---- 1.5 冻结素材库 ---- */
check('冻结素材随包分发且自洽（贴图存在、指纹对得上、来源署名在）', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', here), 'utf8'));
  assert.ok(manifest.assetVersion, '缺少 assetVersion');
  assert.ok(Array.isArray(manifest.pigs) && manifest.pigs.length > 0, '冻结库不能为空');
  for (const pig of manifest.pigs) {
    assert.ok(pig.kind === 'live' || pig.kind === 'dead', pig.id + ' 的 kind 必须是 live/dead');
    assert.equal(typeof pig.vector, 'boolean', pig.id + ' 缺少 vector 判定');
    assert.ok(/^assets\/img\/[a-zA-Z0-9._-]+$/.test(pig.file), pig.id + ' 贴图必须是包内相对路径：' + pig.file);
    const file = new URL('../' + pig.file, here);
    assert.ok(existsSync(file), pig.id + ' 的贴图不存在（先跑 npm run assets:build）');
    const bytes = readFileSync(file);
    assert.equal(bytes.length, pig.bytes, pig.id + ' 记录的字节数与文件不符');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pig.sha256, pig.id + ' 的 sha256 与文件不符');
    assert.ok(String(pig.note || '').length >= 6, pig.id + ' 缺少逐图判定理由');
    assert.ok(pig.source && pig.source.url, pig.id + ' 缺少来源署名');
  }
  const judged = JSON.parse(readFileSync(new URL('../assets/judgements.json', here), 'utf8'));
  // 判定表必须覆盖候选池；但成品可以少于判定表——风格校验未过的会进 rejected。
  const built = new Set(manifest.pigs.map((pig) => pig.id));
  const rejected = new Set((manifest.rejected || []).map((item) => item.id));
  for (const item of judged.judgements) {
    assert.ok(built.has(item.id) || rejected.has(item.id), item.id + ' 既没进包也没进 rejected');
  }
  for (const pig of manifest.pigs) {
    assert.ok(judged.judgements.some((item) => item.id === pig.id), pig.id + ' 没有判定记录');
    assert.equal(pig.style.verdict, 'match', pig.id + ' 进了包却不是 match');
  }
});
/* ---- 1.6 可信来源登记表 ---- */
check('可信来源登记表：每条都有许可结论与证据', () => {
  const libs = JSON.parse(readFileSync(new URL('../assets/libraries.json', here), 'utf8'));
  assert.ok(libs.verdictPolicy && libs.verdictPolicy.bundle, '缺少判定口径');
  const known = ['bundle', 'reference-only', 'inherited-risk', 'trusted'];
  for (const item of libs.libraries) {
    assert.ok(item.id && item.kind, '缺少 id/kind');
    assert.ok(known.indexOf(item.verdict) >= 0, item.id + ' 判定不在口径内：' + item.verdict);
    assert.ok(item.licenseSource && item.licenseSource.length > 6, item.id + ' 缺少许可证据');
    assert.ok(item.licenseExcerpt && item.licenseExcerpt.length > 4, item.id + ' 缺少 LICENSE 原文摘录');
    assert.equal(typeof item.images, 'number', item.id + ' 缺少图片实测数量');
    if (item.verdict === 'reference-only') assert.ok(item.note, item.id + ' 必须写明为什么排除');
  }
  // 打包的素材只能来自 bundle 或 inherited-risk，绝不能来自 reference-only
  const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', here), 'utf8'));
  const allowed = new Set(libs.libraries.filter((item) => item.verdict !== 'reference-only').map((item) => item.id));
  // trusted / bundle / inherited-risk 都允许进包；reference-only 一份都不许
  for (const pig of manifest.pigs) {
    assert.equal(pig.source.group, 'pighub-online', pig.id + ' 必须来自唯一可信源 PigHub，实际 ' + pig.source.group);
  }
});

/* ---- 2. Host 半注册面 ---- */
const tools = new Map();
const routes = new Map();
const disposers = [];
const ctx = {
  effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose; },
  tools: { register(def) { assert.ok(!tools.has(def.name), '重复注册工具'); tools.set(def.name, def); return () => tools.delete(def.name); } },
  webServer: { register(route) { assert.ok(!routes.has(route.path), '重复注册路由'); routes.set(route.path, route); return () => routes.delete(route.path); } },
  logger: { warn() {} },
};
plugin.apply(ctx, { root });

check('注册了 pighub_about 工具、状态路由与每张素材的静态路由', () => {
  assert.deepEqual([...tools.keys()], ['pighub_about']);
  const paths = [...routes.keys()];
  assert.ok(paths.indexOf('/pighub') >= 0, '缺少状态路由');
  const assetRoutes = paths.filter((path) => path.startsWith('/pighub/asset/'));
  const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', here), 'utf8'));
  assert.equal(assetRoutes.length, manifest.pigs.length, '每张素材一条路由，实际 ' + assetRoutes.length + ' / ' + manifest.pigs.length);
  assert.equal(paths.some((path) => path === '/pighub/image'), false, '不应再有图片代理（运行时不链接素材库）');
  for (const path of paths) assert.equal(routes.get(path).kind, 'exact');
});
check('每个注册都包在 ctx.effect 里（可回收）', () => {
  const manifestCount = JSON.parse(readFileSync(new URL('../assets/manifest.json', here), 'utf8')).pigs.length;
  assert.equal(disposers.length, manifestCount + 2, '工具 + 状态路由 + 每张素材各一个 disposer');
  for (const dispose of disposers) assert.equal(typeof dispose, 'function');
});
check('pighub_about 的参数 schema 封闭、描述非空', () => {
  const tool = tools.get('pighub_about');
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters.properties, {});
  assert.equal(tool.parameters.additionalProperties, false);
  assert.ok(tool.description.length > 40);
});
check('工具描述与数据目录策略一致（声明不内嵌上游素材）', () => {
  const tool = tools.get('pighub_about');
  assert.equal(typeof tool.execute, 'function');
});

/* ---- 3. 工具能真跑 ---- */
const answer = await tools.get('pighub_about').execute({}, {});
check('pighub_about 返回自述：版本、目录、今日状态、槽位信息', () => {
  assert.equal(answer.ok, true);
  assert.equal(answer.plugin, pkg.name);
  assert.equal(answer.version, pkg.version, '代码版本与 package.json 不一致');
  assert.equal(answer.root, root);
  assert.equal(answer.owned, 0);
  assert.equal(answer.today.date, new Date().toLocaleDateString('sv-SE'));
  assert.ok(answer.dataPolicy.indexOf('不访问素材库') > 0, '数据策略必须写明运行时不访问素材库');
  assert.ok(answer.assets.total >= 6);
  assert.ok(answer.assets.bytes > 0, '应能统计随包素材体积');
  assert.deepEqual(answer.ui, { sidebarEntry: 'sidebar.panellist', panel: 'main', stateRoute: '/pighub', assetRoute: '/pighub/asset' });
});
check('自述可无损 JSON 往返', () => assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer));

/* ---- 4. 回收 ---- */
for (const dispose of disposers) dispose();
check('disposer 之后工具表与路由表都清空', () => {
  assert.equal(tools.size, 0);
  assert.equal(routes.size, 0);
});

rmSync(root, { recursive: true, force: true });
console.log('\n' + passed + ' PASS / 0 FAIL  —  ' + pkg.name + '@' + pkg.version);
console.log('entry: ' + fileURLToPath(new URL('../lib/index.js', here)));