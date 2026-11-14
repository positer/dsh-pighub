/**
 * 浏览器半的结构测试：**不启动浏览器，但真的执行 factory 并渲染一次组件树**。
 *
 * 做法是把三样宿主提供的东西换成最小的假件：
 *   window.__ModuleLoader__  —— 捕获 load({id, factory})；
 *   require('react')         —— 一个只做记录的最小 React（createElement 返回普通对象，
 *                               hooks 用一个数组模拟首帧 + 重渲染）；
 *   document / fetch         —— 记录样式注入、回一份固定快照。
 *
 * 它能证明：bundle 形状对、三个槽位注册对、组件能渲染、数据能进到界面、桌宠层有/无状态的
 * 分支对。它**不能**证明像素长什么样——那要看真实页面（见 README「验证」）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ 假宿主 */
const styles = [];
const documentStub = {
  head: { appendChild(el) { styles.push(el); } },
  createElement(tag) {
    return { tagName: String(tag).toUpperCase(), dataset: {}, textContent: '', appendChild() {} };
  },
  querySelector(selector) {
    return styles.some((el) => 'style[data-plugin-css="' + el.dataset.pluginCss + '"]' === selector) ? styles[0] : null;
  },
  /* document 级监听（抽卡演出的「点任意处跳过」挂在这里）。
   * 记账而不是真的派发：断言「演出期间确实挂了监听」，再由测试直接调用它模拟一次点击。 */
  listeners: {},
  addEventListener(type, fn) { (documentStub.listeners[type] = documentStub.listeners[type] || []).push(fn); },
  removeEventListener(type, fn) {
    const list = documentStub.listeners[type] || [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  },
  baseURI: 'http://127.0.0.1:1234/',
};
globalThis.document = documentStub;
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};

let loaded = null;
window.__ModuleLoader__ = { load(definition) { loaded = definition; } };

/* 组件里的动画都靠 setInterval 推进；结构测试不需要真的走时间，也不想让进程被
 * 定时器吊住不退出，所以把它换成记账用的假件（记录次数，可断言「装上了定时器」）。 */
let intervalCount = 0;
globalThis.setInterval = () => { intervalCount += 1; return intervalCount; };
globalThis.clearInterval = () => {};

const snapshot = {
  ok: true,
  version: '0.1.0',
  root: 'C:\\Users\\test\\.PigHub',
  today: { date: '2026-11-12', drawn: true, pigId: '3' },
  pigs: [
    // note = manifest 里那条的逐图判定理由（Host 半 2026-11-14 起一并下发）。抽卡演出的卡片就是拿它当描述。
    { id: '3', title: '丙猪', note: '圆胖全身、闭眼微笑，判定为活猪。', assetUrl: '/pighub/asset/pig-c.png', kind: 'live', place: 'pen', rarity: 'common', rarityLabel: '普通', stars: 2, firstObtainedAt: '2026-11-12T01:00:00.000Z', lastUpgradedAt: '2026-11-12T02:00:00.000Z' },
    { id: '1', title: '甲猪', assetUrl: '/pighub/asset/pig-a.png', kind: 'dead', place: 'pen', rarity: 'common', rarityLabel: '普通', stars: 1, firstObtainedAt: '2026-11-11T01:00:00.000Z', lastUpgradedAt: '2026-11-11T01:00:00.000Z' },
  ],
  pets: [],
  // 图鉴用：池子里全部猪猪（含未获取）
  pool: [
    { id: '3', title: '丙猪', url: '/pighub/asset/pig-c.png', note: '圆胖全身、闭眼微笑，判定为活猪。' },
    { id: '1', title: '甲猪', url: '/pighub/asset/pig-a.png' },
    { id: '9', title: '未获得猪', url: '/pighub/asset/pig-z.png' },
  ],
  sort: 'time',
  draws: 2,
  assets: { version: '2026.11.12', total: 6, live: 2, dead: 4, available: true },
  catalog: { count: 1361, fetchedAt: '2026-11-12T00:00:00.000Z', source: 'https://pighub.top/api/images?sort=2', sources: [{ id: 'pighub', count: 1361, ok: true, error: '' }], stale: false, error: '' },
};

const requests = [];
globalThis.__requests = requests;
/* rev 令牌（2026-11-14）：桌宠在场时浏览器半每 250 ms 只问一句令牌，令牌变了才拉整张快照。
 * 这里给一个可写的令牌，测试据此断言「问了几次、拉了几次」。 */
let revToken = '';
if (!globalThis.__rev) globalThis.__rev = { set: (value) => { revToken = value; } };
globalThis.fetch = async (url, options) => {
  const body = options && options.body ? JSON.parse(options.body) : {};
  requests.push({ url, body });
  if (body.action === 'rev') {
    // revToken = null 表示「老宿主没有这个动作」：回 400 unknown_action（真宿主就是这么回的）
    if (revToken === null) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ ok: false, error: 'unknown_action' }) };
    }
    // revToken = 'boom' 模拟插件重载瞬间的失败：这种错误**不许**把客户端永久降级
    if (revToken === 'boom') {
      return { ok: false, status: 500, text: async () => JSON.stringify({ ok: false, error: 'internal_error' }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rev: revToken }) };
  }
  if (body.action === 'place') {
    const pets = body.to === 'pet' ? [body.pigId] : [];
    const store = body.to === 'store' ? [body.pigId] : [];
    const pigs = snapshot.pigs.map((pig) => (pig.id === body.pigId ? Object.assign({}, pig, { place: body.to }) : pig));
    return { ok: true, status: 200, text: async () => JSON.stringify(Object.assign({}, snapshot, { pets, store, pigs })) };
  }
  if (body.action === 'draw') {
    return { ok: true, status: 200, text: async () => JSON.stringify(Object.assign({}, snapshot, { draw: { ok: true, pigId: '3', upgraded: true, stars: 2 } })) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(snapshot) };
};

/* -------------------------------------------------------------- 假 React */
let hookState = null; // 由 render() 指向当前组件的槽
let cursor = 0;
let pendingEffects = [];

function resetRender() { cursor = 0; pendingEffects = []; }
function slots() { return HOOKS.get(currentComponent) || []; }
function useState(init) {
  const store = slots();
  const index = cursor;
  cursor += 1;
  if (!(index in store)) store[index] = typeof init === 'function' ? init() : init;
  const set = (value) => { store[index] = typeof value === 'function' ? value(store[index]) : value; };
  return [store[index], set];
}
function useRef(init) {
  const store = slots();
  const index = cursor;
  cursor += 1;
  if (!(index in store)) store[index] = { current: init };
  return store[index];
}
/* 每次 render 都跑一遍 effect：真实 React 在依赖变化时会重跑，而这个测试台要靠它
 * 模拟「数据到位后 usePenActors 重新播种」这一步；只跑首帧会让死猪/活猪的判定永远测不到。 */
function useEffect(fn) {
  const store = slots();
  const index = cursor;
  cursor += 1;
  store[index] = {};
  pendingEffects.push(fn);
}
function useCallback(fn) { cursor += 1; return fn; }

const ReactStub = {
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2).flat(9);
    return { type, props: props || {}, children };
  },
  useState, useRef, useEffect, useCallback,
};
const requireStub = (id) => {
  if (id === 'react') return ReactStub;
  throw new Error('unexpected require: ' + id);
};

/* -------------------------------------------------------------- 执行 bundle */
await import(new URL('../lib/client.js', import.meta.url).href);

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };
const acheck = async (label, fn) => { await fn(); passed += 1; console.log('PASS  ' + label); };

check('bundle 只做一件事：调用 __ModuleLoader__.load({ id, factory })', () => {
  assert.ok(loaded, 'load 未被调用');
  assert.equal(loaded.id, 'dsh-pighub');
  assert.equal(typeof loaded.factory, 'function');
  assert.deepEqual(Object.keys(loaded).sort(), ['factory', 'id']);
});

const plugin = loaded.factory(requireStub);

check('插件对象：name / inject / apply', () => {
  assert.equal(plugin.name, 'dsh-pighub');
  assert.deepEqual(plugin.inject, ['slots']);
  assert.equal(typeof plugin.apply, 'function');
});

/* 假 ctx：记录槽位注册 */
const registrations = [];
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject(name, factory) {
      assert.equal(typeof factory, 'function');
      return factory();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};
plugin.apply(ctx);

check('注入了一份带前缀的样式，且只注入一次', async () => {
  assert.equal(styles.length, 1);
  const tag = styles[0];
  assert.equal(tag.dataset.plugin, 'dsh-pighub');
  assert.equal(tag.dataset.pluginCss, 'dsh-pighub/panel');
  assert.ok(tag.textContent.indexOf('.pighub-pen') >= 0);
  assert.ok(tag.textContent.indexOf('.pighub-pet') >= 0);
  // 再 apply 一次不应重复注入（同时把这次多出来的槽位注册记录清掉，后面的断言只看一份）
  registrations.length = 0;
  plugin.apply(ctx);
  assert.equal(styles.length, 1, '第二次 apply 重复注入了样式');
});

check('注册三个槽位：sidebar.panellist / main / shell.overlay', () => {
  const names = registrations.map((r) => r.options.name).sort();
  assert.deepEqual(names, ['main', 'shell.overlay', 'sidebar.panellist']);
  const sidebar = registrations.find((r) => r.options.name === 'sidebar.panellist');
  assert.equal(sidebar.options.id, 'pighub');
  assert.equal(sidebar.options.order, 22);
  assert.equal(sidebar.options.label(), 'PigHub');
  const main = registrations.find((r) => r.options.name === 'main');
  assert.equal(main.options.key, 'pighub', 'main 的 key 必须与 sidebar 的 id 相同，布局据此派发');
  const overlay = registrations.find((r) => r.options.name === 'shell.overlay');
  assert.equal(overlay.options.id, 'pighub-pets');
  for (const r of registrations) assert.equal(typeof r.component, 'function');
});

/* ------------------------------------------------------------ 渲染工具 */
function collect(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) { node.forEach((child) => collect(child, out)); return out; }
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (typeof node === 'object') {
    // 函数组件在这里被「展开」一次——最小的渲染器要做的事就是调用它拿到元素树。
    if (typeof node.type === 'function' && node.props && node.props.__expanded !== true) {
      collect(node.type(Object.assign({}, node.props, { __expanded: true })), out);
      return out;
    }
    out.push(node);
    if (Array.isArray(node.children)) node.children.forEach((child) => collect(child, out));
  }
  return out;
}
function textOf(node) {
  return collect(node).filter((x) => typeof x === 'string').join(' ');
}
/** 按 class token 精确匹配（不能用子串：.pighub-pets 里含着 .pighub-pet）。 */
function findByClass(node, className) {
  return collect(node).filter((x) =>
    typeof x === 'object' && x.props && String(x.props.className || '').split(/\s+/).indexOf(className) >= 0);
}
/* 每个组件一份 hook 槽：真实 React 里每个组件实例有自己的 hook 链表，
 * 共用一条数组会让「面板」与「桌宠层」的下标互相踩（这里踩过一次，表现为 useRef 拿到别人的槽）。 */
const HOOKS = new Map();
let currentComponent = null;
async function render(component, props) {
  currentComponent = component;
  const slots = HOOKS.get(component) || [];
  HOOKS.set(component, slots);
  cursor = 0;
  pendingEffects = [];
  const tree = component(props);
  for (const effect of pendingEffects) effect();
  return tree;
}

const sidebar = registrations.find((r) => r.options.name === 'sidebar.panellist').component;
const main = registrations.find((r) => r.options.name === 'main').component;
const overlay = registrations.find((r) => r.options.name === 'shell.overlay').component;

check('侧边栏图标：原色彩色、标准小猪轮廓、镜像朝右、尺寸跟随 props.size', () => {
  resetRender();
  const icon = sidebar({ size: 18 });
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.width, 18);
  assert.equal(icon.props.height, 18);
  assert.equal(icon.props.viewBox, '0 0 24 24');
  const shapes = collect(icon).filter((x) => typeof x === 'object');
  // 镜像靠 g 的 scale(-1 1)：标准小猪默认朝左，要朝右。
  const mirror = shapes.find((x) => x.type === 'g' && String(x.props.transform || '').indexOf('scale(-1 1)') >= 0);
  assert.ok(mirror, '缺少水平镜像：标准小猪默认朝左，要朝右');
  const paths = collect(mirror).filter((x) => x.type === 'path');
  assert.ok(paths.length >= 4, '彩色图标是逐色块描摹出来的多条路径，实际 ' + paths.length);
  // 用户口径（2026-11-13）：侧边栏图标要用**原色彩色**的，不要变黑白。
  for (const path of paths) {
    const fill = String(path.props.fill || '');
    assert.ok(/^rgb\(/.test(fill), '每个色块必须带源图实测颜色，而不是 currentColor：' + fill);
    assert.notEqual(fill, 'currentColor', '不许再用 currentColor（那会跟着侧栏变黑白）');
    assert.ok(String(path.props.d).length > 20, '色块路径太短，可能是坏数据');
  }
  const colors = new Set(paths.map((x) => x.props.fill));
  assert.ok(colors.size >= 4, '至少要有 4 种颜色才是「彩色猪」，实际 ' + colors.size);
});

const pixelTitle = collect;
await acheck('面板首帧：猪圈（空）、像素标题、「今日猪猪」、三个排序按钮', async () => {
  const tree = await render(main);
  const text = textOf(tree);
  assert.ok(text.indexOf('今日猪猪') >= 0 || text.indexOf('今日已获取') >= 0, '缺少今日按钮');
  assert.ok(text.indexOf('按获取时间') >= 0 && text.indexOf('按星级') >= 0 && text.indexOf('按稀有度') >= 0, '缺少排序按钮');
  assert.ok(findByClass(tree, 'pighub-pen').length === 1, '缺少猪圈');
  // 围栏是**用户给的一张图**（assets/img/pen-fence.png，逐字节原样入库）按同一条水平线切成两层：
  // 远层画在猪后面、近层画在猪前面。这里断的是「结构对得上账」与「三层几何的包含关系」，
  // 像素级证据（叠回 diff = 0、真机遮挡截图）在 archive/pen-fence-art.md。
  // 注意：函数组件每展开一次就生成一组新元素，所以整块只用**一次** collect 的结果做身份比较。
  const flat = collect(tree);
  const byClass = (cls) => flat.filter((x) => typeof x === 'object' && x.props
    && String(x.props.className || '').split(/\s+/).indexOf(cls) >= 0);
  const fences = byClass('pighub-fence');
  assert.equal(fences.length, 2, '栅栏应该是两层（远/近），实际 ' + fences.length);
  const backFence = fences.filter((fence) => String(fence.props.className).indexOf('is-back') >= 0);
  const frontFence = fences.filter((fence) => String(fence.props.className).indexOf('is-front') >= 0);
  assert.equal(backFence.length, 1, '缺少远侧栅栏（顶横梁那一半）');
  assert.equal(frontFence.length, 1, '缺少近侧栅栏（底横梁那一半）');
  // 两层都用**同一张** 1254 见方的图：每层盒里只有一个 shot，指向包内路由；没有第二张素材。
  const shots = byClass('pighub-fence-shot');
  assert.equal(shots.length, 2, '两层各应有一张 shot，实际 ' + shots.length);
  for (const shot of shots) {
    const bg = String(shot.props.style.backgroundImage || '');
    assert.equal(bg, 'url("/pighub/pen/pen-fence.png")', '两层必须指向同一张图：' + bg);
  }
  // 分割线是同一个数：远层 height = 近层 top = PEN_FENCE_SPLIT（同一条水平线，不是两条）
  const split = plugin.__test.PEN_FENCE_SPLIT;
  assert.equal(String(backFence[0].props.style.height), split + '%', '远层高度必须是分割线');
  assert.equal(String(frontFence[0].props.style.top), split + '%', '近层起点必须是同一条分割线');
  assert.equal(String(frontFence[0].props.style.bottom), '0', '近层要一直铺到猪圈底');
  assert.ok(split > 40 && split < 60, '分割线要落在内圈竖直中点附近，实际 ' + split);
  // 顺序：远层先画、近层最后画（z 序在下面另有一条断言）
  assert.ok(flat.indexOf(frontFence[0]) > flat.indexOf(backFence[0]), '近侧栅栏必须在远侧之后绘制');
  const penNode = byClass('pighub-pen')[0];
  assert.ok(penNode, '缺少猪圈');
  const penKids = penNode.children.filter((child) => child !== null && child !== undefined && child !== false);
  const lastKid = penKids[penKids.length - 1];
  assert.equal(lastKid.props && lastKid.props.front, true, '近侧栅栏必须是猪圈里最后画的那一个（它要压住所有猪）');
  // 草地按用户红框内缩：clip 盒的四条边就是 PEN_GRASS，草簇被它裁住（overflow:hidden 在 CSS 里）
  const grassClip = byClass('pighub-grass-clip');
  assert.equal(grassClip.length, 1, '草地应有一个裁剪盒，实际 ' + grassClip.length);
  const G = plugin.__test.PEN_GRASS;
  const gs = grassClip[0].props.style;
  assert.equal(gs.left, G.x0 + '%');
  assert.equal(gs.top, G.y0 + '%');
  assert.equal(gs.right, Math.round((100 - G.x1) * 100) / 100 + '%');
  assert.equal(gs.bottom, Math.round((100 - G.y1) * 100) / 100 + '%');
  const grassSvg = byClass('pighub-grass');
  assert.equal(grassSvg.length, 1, '裁剪盒里应恰好一张草地 SVG');
  assert.ok(parseFloat(grassSvg[0].props.style.left) < 0 && parseFloat(grassSvg[0].props.style.width) > 100,
    '草地 SVG 仍按「猪圈 0..100」的坐标铺回原位（负偏移 + 放大），靠裁剪盒收进红框');
  assert.equal(byClass('pighub-house').length, 1, '缺少仓库小屋');
  const title = collect(tree).filter((x) => typeof x === 'object' && x.props && x.props['aria-label'] === 'PigHub');
  assert.equal(title.length, 1, '缺少像素标题');
  const rects = collect(title[0]).filter((x) => typeof x === 'object' && x.type === 'rect');
  assert.ok(rects.length > 60, '像素标题方块太少：' + rects.length);
});

/* --------------------------------------------- 围栏的 z 序与三层几何（§Q 的代码手段） */
/** 从注入的那份 CSS 里抠出一条规则（选择器 → 花括号里的内容）。 */
function splitValue() { return plugin.__test.PEN_FENCE_SPLIT; }

function cssRule(selector) {
  const text = styles[0].textContent;
  const at = text.indexOf(selector + '{');
  if (at < 0) throw new Error('CSS 里找不到规则：' + selector);
  return text.slice(at + selector.length + 1, text.indexOf('}', at));
}

await acheck('z 序：远栏 < 小屋 < 猪（脚底排序档）< 近栏（小屋压后栏、猪压小屋、近栏压猪）', async () => {
  const zOf = (selector) => {
    const m = cssRule(selector).match(/z-index:\s*(-?\d+)/);
    assert.ok(m, selector + ' 没有写 z-index（auto 的话会被 / 不会盖住别人）');
    return Number(m[1]);
  };
  const Z = plugin.__test;
  // 档位常量（另一条线 2026-11-14 抽出来的：猪之间按脚底排序，所以猪是一整档而不是一个数）
  assert.equal(zOf('.pighub-fence.is-back'), Z.Z_FENCE_BACK, '远侧栅栏必须画在猪身后');
  assert.equal(zOf('.pighub-house'), Z.Z_HOUSE, '小屋要压住后面的栅栏（所以高于远栏）');
  assert.equal(zOf('.pighub-actor'), Z.Z_ACTOR_MIN, '猪那一档的默认值（一帧零只猪时的 z）');
  assert.equal(zOf('.pighub-fence.is-front'), Z.Z_FENCE_FRONT, '近侧栅栏必须画在猪身前');
  // 真正要守的是**顺序**，不是四个具体数字：小屋压后栏、猪压小屋、近栏压猪
  assert.ok(Z.Z_FENCE_BACK < Z.Z_HOUSE, '小屋必须高于远栏');
  assert.ok(Z.Z_HOUSE < Z.Z_ACTOR_MIN, '猪必须高于小屋（走到小屋前面时猪在小屋之上）');
  assert.ok(Z.Z_ACTOR_MAX < Z.Z_FENCE_FRONT, '整档猪都必须低于近栏（走到底边的猪被挡一截）');
  assert.ok(Z.Z_FENCE_FRONT < Z.Z_SETTINGS && Z.Z_SETTINGS < Z.Z_GALLERY, '设置/图鉴要压在近栏之上');
});

await acheck('猪圈自己不画像素：没有底色、没有描边、没有铺满全圈的装饰', async () => {
  // 用户口径（2026-11-14）：草地与围栏本体之外的区域 alpha 必须为 0，直接露宿主页面底色。
  // 「给猪圈画一块底色」在视觉上就是「猪圈是一个深色/绿色方块」——所以这条断言盯的就是它。
  const pen = cssRule('.pighub-pen');
  assert.ok(/background:\s*transparent/.test(pen), '猪圈不能有底色：' + pen);
  assert.ok(pen.indexOf('box-shadow') < 0, '猪圈不能有描边（那不是内容，是在透明区画了一圈线）');
  assert.ok(pen.indexOf('gradient') < 0, '不许用渐变铺底');
  // 铺满全圈的装饰层：任何 inset:0 且带 background 的猪圈子层都会被这条抓出来
  for (const selector of ['.pighub-grass', '.pighub-fence-shot', '.pighub-fence']) {
    const rule = cssRule(selector);
    assert.ok(rule.indexOf('background-color') < 0, selector + ' 不许有底色');
  }
  // 草地裁剪盒四边都在红框上（不是 inset:0）——它自己是唯一铺草的层
  assert.ok(cssRule('.pighub-grass-clip').indexOf('overflow:hidden') >= 0, '草地必须被裁剪盒裁住，不能溢出红框');
});

await acheck('三层矩形：草坪红框 ⊃ 栅栏内圈 ⊃ 猪的活动区（各收半个猪身）', async () => {
  const { PEN_INNER, PEN_GRASS, PEN_BOX } = plugin.__test;
  // 1) 草坪红框包住栅栏内圈：草要铺到木头底下，否则栏下会露出一条「没有草」的亮带。
  assert.ok(PEN_GRASS.x0 <= PEN_INNER.x0 && PEN_GRASS.x1 >= PEN_INNER.x1
    && PEN_GRASS.y0 <= PEN_INNER.y0 && PEN_GRASS.y1 >= PEN_INNER.y1,
    '草坪红框没包住内圈：' + JSON.stringify({ PEN_GRASS, PEN_INNER }));
  // 2) 猪的活动区 = 内圈各收半个猪身（参考猪 96px 宽、256 只实测中位高宽比 0.888、451px 猪圈）。
  const halfW = (96 / 2 / 451) * 100;
  const halfH = ((96 * 0.888) / 2 / 451) * 100;
  assert.ok(PEN_BOX.x0 - halfW >= PEN_INNER.x0 - 0.02, '猪身左缘会越出栅栏内圈');
  assert.ok(PEN_BOX.x1 + halfW <= PEN_INNER.x1 + 0.02, '猪身右缘会越出栅栏内圈');
  assert.ok(PEN_BOX.y0 - halfH >= PEN_INNER.y0 - 0.02, '猪身上缘会越出栅栏内圈');
  assert.ok(PEN_BOX.y1 + halfH <= PEN_INNER.y1 + 0.02, '猪身下缘会越出栅栏内圈');
  // 3) 仓库小屋（left/top/width/aspect 从 CSS 里读，抄常量就是自证）。用户口径 2026-11-14：
  //    小屋站在草坪远端、**挡住后面的栅栏**。判据不是「看着像」，是三条能对账的几何关系：
  //    ① 屋底落在草坪里（立在草坪上，不是浮空）；② 屋身把远栏两道横梁整段盖住（重叠高度给数）；
  //    ③ 整只都在分割线以上（只压后栏，不盖前景栏）。
  const house = cssRule('.pighub-house');
  const num = (key) => Number((house.match(new RegExp(key + ':\\s*(-?[\\d.]+)%')) || [])[1]);
  const houseLeft = num('left');
  const houseTop = num('top');
  const houseWidth = num('width');
  const aspect = house.match(/aspect-ratio:\s*([\d.]+)\/([\d.]+)/);
  assert.ok(houseLeft > 0 && houseTop > 0 && houseWidth > 0 && aspect, '小屋的 CSS 读数不完整：' + house);
  const houseHeight = (houseWidth * Number(aspect[2])) / Number(aspect[1]);
  // SVG 里真正画到的范围（overflow:visible）：x 1.4..36.6 / 40，y 2.2..30.2 / 34
  const drawn = {
    x0: houseLeft - houseWidth * (1.4 / 40),
    x1: houseLeft + houseWidth * (36.6 / 40),
    y0: houseTop - houseHeight * (2.2 / 34),
    y1: houseTop + houseHeight * (30.2 / 34),
  };
  const houseBottom = houseTop + houseHeight;
  // ① 屋底（含 SVG 画到的投影 30.2/34）落在草坪里：小屋是「立在草坪远端」，不是浮空
  assert.ok(drawn.y1 <= PEN_GRASS.y1 && drawn.y1 > PEN_GRASS.y0 + 1,
    '小屋投影不在草坪里：' + JSON.stringify({ drawn, PEN_GRASS }));
  assert.ok(houseBottom > PEN_GRASS.y0, '屋底必须压进草坪（红框上沿 ' + PEN_GRASS.y0 + '%），实际 ' + houseBottom.toFixed(2) + '%');
  // ② 与远栏两道横梁的重叠高度（横梁 y 带由 1254 原图实测：上 8.29..12.28、下 14.11..17.46）
  const RAIL_TOP = 8.29;
  const RAIL_BOTTOM = 17.46;
  const covered = Math.min(houseBottom, RAIL_BOTTOM) - Math.max(houseTop, RAIL_TOP);
  assert.ok(houseTop < RAIL_TOP, '小屋上沿必须高于上横梁上缘（否则只能压到下半截）');
  assert.ok(covered >= 9, '小屋没把横梁整段盖住：重叠 ' + covered.toFixed(2) + ' 个百分点');
  assert.ok(covered > houseHeight * 0.5, '压在横梁上的高度要超过屋高一半，才算「挡住栅栏」');
  // ③ 与左立柱重叠（转角那一块最明显），且整只在分割线以上
  assert.ok(houseLeft < PEN_INNER.x0 - 1, '小屋必须与左立柱重叠：left=' + houseLeft);
  assert.ok(houseBottom < splitValue(), '小屋整只必须在分割线以上（它只压后栏，不许盖前景栏）');
});

await acheck('数据到位后重渲染：今日已获取、清单两条、星级与两种时间都在', async () => {
  await new Promise((r) => setTimeout(r, 30)); // 让首帧 effect 里的 load() 落地
  const tree = await render(main);
  const text = textOf(tree);
  assert.ok(text.indexOf('今日已获取') >= 0, '今天已抽过，按钮应显示已获取');
  assert.ok(text.indexOf('丙猪') >= 0 && text.indexOf('甲猪') >= 0, '清单里应有两只猪');
  assert.ok(text.indexOf('首次获得') >= 0 && text.indexOf('最近升星') >= 0, '两条时间都要显示');
  assert.ok(text.indexOf('\u2605\u2605') >= 0, '2 星应显示两颗星');
  // 抽池是冻结素材库（assets.total=6），不是下一版候选池（catalog.count=1361）。
  // 真实安装里候选池为空，旧写法会印成「0 只猪猪可选」——而按「今日猪猪」明明能抽。
  assert.ok(text.indexOf('6 只猪猪可选') >= 0, '「可选」必须是冻结素材库只数（6），实际文本：' + text);
  assert.ok(text.indexOf('0 只猪猪可选') < 0, '不得再用候选池的 0 冒充可选数');
  assert.ok(text.indexOf('候选池 1361 只') >= 0, '候选池有数时应单列，实际文本：' + text);
  const actors = findByClass(tree, 'pighub-actor');
  assert.equal(actors.length, 2, '猪圈里应有两只猪（pets 为空）');
  assert.ok(requests.some((r) => r.body.action === 'state'), '开面板时读过一次 state');
});

await acheck('桌宠层：没有桌宠时不渲染（不占层）', async () => {
  const tree = await render(overlay);
  assert.equal(tree, null);
});

/** 猪的拖拽句柄挂在内层 img 上（外层是负责定位与动画的容器）。 */
function actorImg(tree) {
  const wrapper = findByClass(tree, 'pighub-actor')[0];
  assert.ok(wrapper, '猪圈里应有一个猪的容器');
  const img = collect(wrapper).find((x) => typeof x === 'object' && x.type === 'img');
  assert.ok(img, '容器里应有 img');
  return img;
}

await acheck('拖动猪：小幅移动不触发桌宠，拖出猪圈才变成桌宠', async () => {
  const tree = await render(main);
  const actor = actorImg(tree);
  assert.equal(typeof actor.props.onPointerDown, 'function', '猪圈里的猪要能开始拖拽');
  const capture = { setPointerCapture() {}, releasePointerCapture() {} };
  const before = requests.filter((r) => r.body.action === 'place').length;

  // ① 原地抖一下（< 5px 阈值）：不该改变归属
  actor.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  actor.props.onPointerMove({ button: 0, clientX: 302, clientY: 302 });
  actor.props.onPointerUp({ clientX: 302, clientY: 302 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(requests.filter((r) => r.body.action === 'place').length, before, '阈值内的抖动不应发起放置请求');

  // ② 拖出去（> 5px 且落点在猪圈外）：变成桌宠
  actor.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  actor.props.onPointerMove({ clientX: 900, clientY: 640 });
  actor.props.onPointerUp({ clientX: 900, clientY: 640 });
  await new Promise((r) => setTimeout(r, 20));
  const petRequests = requests.filter((r) => r.body.action === 'place' && r.body.to === 'pet');
  assert.equal(petRequests.length, 1, '拖出猪圈应发一次 pet=true');
  assert.equal(petRequests[0].body.pigId, '3', '被拖走的应是那只猪');
});

await acheck('桌宠拖进猪圈即回圈（不必双击）', async () => {
  // 猪圈矩形由面板实测后报给 store；这里直接注入一个 100x100 的矩形当"猪圈"。
  plugin.__test.setPenRect({ left: 100, top: 100, width: 100, height: 100 });
  const tree = await render(overlay);
  const pet = findByClass(tree, 'pighub-pet')[0];
  assert.ok(pet, '应有桌宠元素');
  assert.equal(typeof pet.props.onPointerUp, 'function');
  const before = requests.filter((r) => r.body.action === 'place' && r.body.to === 'pen').length;
  // ① 在猪圈外松手：不改归属
  pet.props.onPointerUp({ clientX: 900, clientY: 700 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(requests.filter((r) => r.body.action === 'place' && r.body.to === 'pen').length, before, '圈外松手不该回圈');
  // ② 在猪圈矩形内松手：应发出 place to=pen
  pet.props.onPointerUp({ clientX: 150, clientY: 150 });
  await new Promise((r) => setTimeout(r, 20));
  const back = requests.filter((r) => r.body.action === 'place' && r.body.to === 'pen');
  assert.equal(back.length, before + 1, '拖进猪圈松手应发一次 place to=pen');
  // 这条测试会把桌宠收回猪圈，后面的用例还要用桌宠——放回去，别让状态互相踩。
  await plugin.__test.place('3', 'pet');
  await new Promise((r) => setTimeout(r, 20));
});

await acheck('桌宠层：有桌宠时渲染在页面级容器里，可拖动、可双击回圈', async () => {
  const tree = await render(overlay);
  assert.ok(tree, '有桌宠时桌宠层必须存在');
  const container = findByClass(tree, 'pighub-pets');
  assert.equal(container.length, 1, '页面级容器只应有一个');
  const pet = findByClass(tree, 'pighub-pet');
  assert.equal(pet.length, 1, '每只桌宠一个元素，实际 ' + pet.length);
  assert.equal(pet[0].type, 'div', '桌宠是容器（内含 img 与星级胶囊）');
  const petImg = collect(pet[0]).find((x) => typeof x === 'object' && x.type === 'img');
  assert.ok(petImg, '桌宠容器里应有 img');
  assert.equal(petImg.props.src, '/pighub/asset/pig-c.png');
  assert.equal(typeof pet[0].props.onPointerDown, 'function');
  assert.equal(typeof pet[0].props.onDoubleClick, 'function');
  assert.ok(pet[0].props.style.left.endsWith('px') && pet[0].props.style.top.endsWith('px'));

  // 拖动桌宠：位置跟着指针走
  const capture = { setPointerCapture() {}, releasePointerCapture() {} };
  pet[0].props.onPointerDown({ button: 0, pointerId: 2, clientX: 500, clientY: 400, currentTarget: capture });
  pet[0].props.onPointerMove({ clientX: 560, clientY: 430 });
  pet[0].props.onPointerUp({ clientX: 560, clientY: 430 });
  const moved = findByClass(await render(overlay), 'pighub-pet')[0];
  assert.ok(moved.props.style.left.endsWith('px'));

  // 双击：回猪圈（pet=false）
  const before = requests.filter((r) => r.body.action === 'place' && r.body.to === 'pen').length;
  moved.props.onDoubleClick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(requests.filter((r) => r.body.action === 'place' && r.body.to === 'pen').length, before + 1, '双击应发一次放回猪圈');
});

await acheck('单步 = 1.65–3.0 个身位（与桌宠同口径），一次决策最多走 1.7 身位，且不越出活动区', () => {
  const { penStep, penBodyPct, stepRangePct, PEN_BOX, PIG_PX, STEP_MIN_BODY, STEP_MAX_BODY, STEP_CAP_BODY } = plugin.__test;
  assert.equal(typeof penStep, 'function', 'penStep 应作为纯函数暴露给测试');
  // 用户口径（2026-11-13）：「猪圈和桌宠的行为以及大小完全一致，以桌宠行为为准」。
  assert.equal(PIG_PX, 96, '本体尺寸应与桌宠一致（96px）');
  // 先钉死猪圈宽度：前面的用例改过 penRect，身位换算必须在一个确定的宽度下比对。
  plugin.__test.setPenRect({ left: 0, top: 0, width: 451, height: 451 });
  const body = penBodyPct(PIG_PX);
  const range = stepRangePct(PIG_PX);
  // ① 身位换算：1 身位 = sizeRatio / 猪圈宽度 × 100（本机实测宽度 451px）
  assert.ok(Math.abs(body - (96 / 451) * 100) < 1e-9, '身位 → 百分点的换算不对，实测 ' + body.toFixed(4));
  // ② 采样区间就是桌宠的 [1.65, 3.0] 身位（不再整体缩放）
  assert.ok(Math.abs(range.min - body * STEP_MIN_BODY) < 1e-9, '步长下限不是 1.65 身位');
  assert.ok(Math.abs(range.max - body * STEP_MAX_BODY) < 1e-9, '步长上限不是 3.0 身位');
  assert.ok(Math.abs(range.max / range.min - STEP_MAX_BODY / STEP_MIN_BODY) < 1e-6,
    '步长区间比例应与桌宠一致（3.0/1.65），实测 ' + (range.max / range.min).toFixed(3));
  // ③ 一窗上限 = 速度 × 决策间隔（桌宠下一次决策会打断走路）
  assert.ok(Math.abs(STEP_CAP_BODY - 1.7) < 1e-9, '一窗位移上限应为 1.7 身位，实测 ' + STEP_CAP_BODY);
  let from = { x: (PEN_BOX.x0 + PEN_BOX.x1) / 2, y: (PEN_BOX.y0 + PEN_BOX.y1) / 2 };
  let maxDist = 0;
  for (let i = 0; i < 2000; i += 1) {
    const next = penStep(from, PIG_PX);
    const distance = Math.hypot(next.x - from.x, next.y - from.y);
    maxDist = Math.max(maxDist, distance);
    assert.ok(distance <= range.cap + 1e-9, '单步超过一窗上限：' + distance.toFixed(2) + ' > ' + range.cap.toFixed(2));
    assert.ok(next.x >= PEN_BOX.x0 - 1e-9 && next.x <= PEN_BOX.x1 + 1e-9, '越出左右活动区：' + next.x);
    assert.ok(next.y >= PEN_BOX.y0 - 1e-9 && next.y <= PEN_BOX.y1 + 1e-9, '越出上下活动区：' + next.y);
    from = next;
  }
  assert.ok(maxDist > range.cap * 0.9, '实际位移应覆盖到一窗上限，实测最大 ' + maxDist.toFixed(2) + ' / 上限 ' + range.cap.toFixed(2));
  // ④ 采样分布 = 桌宠的分布 [1.65, 3.0) 身位；真正走的步长被截在一窗上限（cs:230 + cs:244）
  const { penDecide } = plugin.__test;
  let lo = Infinity; let hi = -Infinity; let capped = 0; let walks = 0;
  for (let i = 0; i < 5000; i += 1) {
    const d = penDecide({ x: 50, y: 46 }, PIG_PX);
    if (!d.walk) continue;
    walks += 1;
    lo = Math.min(lo, d.stepBody);
    hi = Math.max(hi, d.stepBody);
    assert.ok(d.stepBody >= STEP_MIN_BODY && d.stepBody < STEP_MAX_BODY, '采样步长越界：' + d.stepBody);
    assert.ok(Math.abs(d.walkBody - Math.min(d.stepBody, STEP_CAP_BODY)) < 1e-12, '走路步长必须截在一窗上限，实测 ' + d.walkBody);
    if (d.walkBody < d.stepBody) capped += 1;
  }
  assert.ok(walks > 1000, '走动样本太少，实测 ' + walks);
  assert.ok(lo < STEP_MIN_BODY + 0.05 && hi > STEP_MAX_BODY - 0.05,
    '采样步长应覆盖 1.65~3.0 的整个区间，实测 ' + lo.toFixed(3) + '~' + hi.toFixed(3));
  assert.ok(capped / walks > 0.9, '3.0 的区间里只有 3.7% 落在 1.7 身位以内，绝大部分应被截断，实测 ' + ((100 * capped) / walks).toFixed(1) + '%');
});

check('贴边是夹取不是反弹（cs:249-251）：落点夹回活动区，方向与步长都不重掷', () => {
  const { penStep, penDecide, PEN_BOX, PIG_PX, penBodyPct, STEP_CAP_BODY } = plugin.__test;
  const cap = penBodyPct(PIG_PX) * STEP_CAP_BODY;
  /** 预置随机数序列：一次决策最多取两个（角度、步长）。 */
  const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
  // ① 从右边界继续朝右走（角度 0，步长取满）：落点被夹在右边界，y 不动
  let target = penStep({ x: PEN_BOX.x1 - 0.5, y: 50 }, PIG_PX, seq([0, 1]));
  assert.ok(Math.abs(target.x - PEN_BOX.x1) < 1e-9, '朝墙走应被夹在右边界，实测 x=' + target.x);
  assert.ok(Math.abs(target.y - 50) < 1e-9, '横向走不该改变 y，实测 y=' + target.y);
  // 夹取没有吃掉步长：落点 = 夹取(起点 + cos0 × 一窗上限)，而不是「重掷一个恰好放得下的角度」
  assert.ok(Math.abs(target.x - Math.min(PEN_BOX.x1, PEN_BOX.x1 - 0.5 + cap)) < 1e-9, '夹取不应改变被夹住之前的步长');
  // ② 角落朝外走（3π/4）：两个轴同时夹住 → 正好落在角上
  target = penStep({ x: PEN_BOX.x0 + 0.5, y: PEN_BOX.y1 - 0.5 }, PIG_PX, seq([0.375, 1]));
  assert.ok(Math.abs(target.x - PEN_BOX.x0) < 1e-9 && Math.abs(target.y - PEN_BOX.y1) < 1e-9,
    '角落朝外走应落在角上，实测 ' + JSON.stringify(target));
  // ③ 随机数用量与桌宠一致（cs:232 发呆 / 233 角度 / 234 步长）：走动 3 个、发呆 1 个
  let draws = 0;
  const counting = (value) => () => { draws += 1; return value; };
  draws = 0; penDecide({ x: 50, y: 50 }, PIG_PX, counting(0.9));
  assert.equal(draws, 3, '走动的一次决策应只掷 3 个随机数（旧实现最多 15 个），实测 ' + draws);
  draws = 0; penDecide({ x: 50, y: 50 }, PIG_PX, counting(0.1));
  assert.equal(draws, 1, '发呆的一次决策只掷 1 个随机数，实测 ' + draws);
});

check('调度器的「没变化就跳过重渲染」必须包含 nextAt/fresh（否则发呆一拍会丢掉计时）', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('a.nextAt !== b.nextAt') >= 0, '比较里必须有 nextAt，否则计时被丢弃、猪不再移动');
  assert.ok(source.indexOf('a.fresh !== b.fresh') >= 0, '比较里必须有 fresh，否则「先发呆一拍」永远清不掉');
});

check('拖动一定会结束：有 document 级 pointerup 兜底（否则猪会永久隐身且拖不动）', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf("addEventListener('pointerup', finish)") >= 0, '需要全局 pointerup 兜底');
  assert.ok(source.indexOf("addEventListener('pointercancel', finish)") >= 0, '需要 pointercancel 兜底');
});

check('尺寸按 sizeRatio 归一化：猪圈本体与桌宠用同一系数', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('pig.sizeRatio || 96') >= 0, '本体宽度应取 sizeRatio');
  assert.ok(source.indexOf('(pig.sizeRatio || 96) + ' + String.fromCharCode(39) + 'px' + String.fromCharCode(39)) >= 0, '应把 sizeRatio 写成像素宽度');
});

check('尺寸两层一致：猪圈本体与桌宠都是 96px；拖动时本体真的隐藏', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('width:96px') >= 0, '猪元素宽度应是固定 96px');
  assert.ok(source.indexOf('width:15%') < 0, '不应再按猪圈宽度百分比缩放（会和桌宠大小不一致）');
  assert.ok(source.indexOf('.pighub-actor.is-hidden{') >= 0, 'is-hidden 必须有样式，否则拖动时原地还留一只');
});

check('每只猪独立计时：调度靠每个 actor 的 nextAt，而不是一个全局 tick 一起走', () => {
  const { DECISION_MS } = plugin.__test;
  assert.ok(DECISION_MS > 0, '决策间隔必须是正数');
  // 结构性断言：源码里必须是「每只猪 nextAt 到点才动」，且不再有旧的全员 1700ms 定时器。
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('nextAt') >= 0, '应当用每只猪的 nextAt 计时');
  assert.ok(source.indexOf('now < current.nextAt') >= 0, '应当有「还没轮到就不动」的判断');
  assert.ok(source.indexOf('}, 1700);') < 0, '旧的全局 1.7s tick 应当已经移除');
  assert.ok(source.indexOf('}, 250);') >= 0, '调度器应是 250ms 扫描一次');
});

await acheck('进入面板时猪就在记录的位置上（不是从网格原点开始）', async () => {
  // 给 fixture 的第一只猪记一个位置，重新渲染后它应该落在 40%/50% 处
  const pig = snapshot.pigs[0];
  const backup = pig.pos;
  pig.pos = { x: 40, y: 50 };
  await plugin.__test.place(pig.id, 'pen');
  // 用户口径：「不要每次进入猪圈猪都从中心移到位置」——
  // 所以**首帧**就要落在记录点上，不能靠 effect 第二次渲染才纠正。
  await render(main);
  const tree = await render(main);
  const actors = findByClass(tree, 'pighub-actor');
  const styles = actors.map((a) => a.props.style || {});
  const hit = styles.filter((s) => String(s.left) === '40%' && String(s.top) === '50%');
  assert.equal(hit.length, 1, '应有一只猪正好落在记录的 40%/50%，实际 ' + JSON.stringify(styles.map((s) => [s.left, s.top])));
  pig.pos = backup;
});

check('松手后原地站稳：SETTLE_MS 存在且 > 一个 tick', () => {
  const { SETTLE_MS } = plugin.__test;
  assert.equal(typeof SETTLE_MS, 'number');
  assert.ok(SETTLE_MS >= 1700, '站稳时长至少覆盖一个 tick（1.7s），否则松手就被下一拍带走，实际 ' + SETTLE_MS);
});

/* 这条原来是 check(...) + async body：断言落在没人 await 的将来，后来的用例一并发请求就会串账
 * （本轮加「松手落点 = 新起点」那条时立刻撞上：before 记 1、实际 filter 到 3）。改成 await 的 acheck。 */
await acheck('拖动落点在猪圈内 = 换位置（不是取消）', async () => {
  // 猪圈矩形由面板实测后报给 store；注入一个固定矩形，让落点换算可断言。
  plugin.__test.setPenRect({ left: 200, top: 200, width: 400, height: 400 });
  const tree = await render(main);
  const actor = actorImg(tree);
  const capture = { setPointerCapture() {}, releasePointerCapture() {} };
  const before = requests.filter((r) => r.body.action === 'position').length;
  actor.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  actor.props.onPointerMove({ clientX: 400, clientY: 400 });
  actor.props.onPointerUp({ clientX: 400, clientY: 400 });
  await new Promise((r) => setTimeout(r, 20));
  const saved = requests.filter((r) => r.body.action === 'position');
  assert.equal(saved.length, before + 1, '圈内松手应写回一次落点');
  // 落点换算：(400-200)/400 = 50%
  assert.ok(Math.abs(saved[saved.length - 1].body.x - 50) < 1, '落点 x 应按矩形换算成百分比，实际 ' + saved[saved.length - 1].body.x);
  assert.ok(Math.abs(saved[saved.length - 1].body.y - 50) < 1, '落点 y 应按矩形换算成百分比，实际 ' + saved[saved.length - 1].body.y);
  // 落地后的「站稳」只许有一个计时器（holdUntil = SETTLE_MS）。再叠 fresh 会额外推后一个
  // DECISION_MS，实测体感就是「拖动落地后猪僵住」（用户 2026-11-14 追加反馈）。
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('moveActorHandler = (pigId, x, y) => {'));
  const body = handler.slice(0, handler.indexOf('};'));
  assert.ok(body.indexOf('holdUntil: Date.now() + SETTLE_MS') >= 0, '落地要有一个 SETTLE_MS 的站稳计时');
  assert.ok(body.indexOf('fresh: false') >= 0, '落地不许再叠 fresh（那会再多等一个 DECISION_MS）');
});


/* 「松手落地在哪，就更新游走位置起点在哪」（用户口径 2026-11-14，原话）：
 * 落地即为新的**游走起点**，**不许有任何回头/回溯的位移**。
 *
 * 这条测试盯的是「落点有没有被旧快照抢回去」，不是"跳变"：
 *   - 松手那一拍 pan 的 effect 会重跑（签名里带 drag 标志），旧实现把快照里的 pos
 *     当成「宿主改过位置」，于是把 actor **平滑搬回拖动前的位置**（实测反向 132px / 1.6 s）；
 *   - 下一张快照回传落点时，又按同一分支**平滑搬回落点**（第二段位移）。
 * 两个不变量：①落点不被旧值抢回；②宿主回传的落点（我们自己写下去的那一版）不产生任何位移；
 * 同时**不许把「外部真的改了位置」一起废掉**（第三个断言就是这条护栏）。 */
await acheck('松手落点就是新的游走起点：旧快照不许把它抢回去，宿主回传落点也不许再滑一段', async () => {
  const pen = { left: 200, top: 200, width: 400, height: 400 };
  plugin.__test.setPenRect(pen);
  const pig = snapshot.pigs[0];               // id '3'：会动的那只
  const backup = pig.pos;
  // 拖动前它站在 20%/20%（这份 pos 会在松手后继续作为**旧快照**存在，正是元凶）
  pig.pos = { x: 20, y: 20 };
  await plugin.__test.place(pig.id, 'pen');
  await render(main);
  let tree = await render(main);
  let actor = findByClass(tree, 'pighub-actor')[0];
  assert.deepEqual([actor.props.style.left, actor.props.style.top], ['20%', '20%'], '基线：拖动前应站在旧快照的位置上');

  // 拖到 (400,400) → 落点 = (400-200)/400 = 50%/50%
  const capture = { setPointerCapture() {}, releasePointerCapture() {} };
  const img = collect(actor).find((x) => typeof x === 'object' && x.type === 'img');
  img.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  img.props.onPointerMove({ clientX: 400, clientY: 400 });
  img.props.onPointerUp({ clientX: 400, clientY: 400 });
  await new Promise((r) => setTimeout(r, 20));

  // ① 松手后（effect 至少跑过一轮）actor 必须停在落点上，不能回到 20%/20%
  await render(main);
  tree = await render(main);
  actor = findByClass(tree, 'pighub-actor')[0];
  assert.deepEqual([actor.props.style.left, actor.props.style.top], ['50%', '50%'],
    '松手后 actor 必须停在落点（50%/50%），实际 ' + JSON.stringify([actor.props.style.left, actor.props.style.top]));
  assert.equal(String(actor.props.style.transitionDuration), '0ms',
    '落地这一拍不许带在飞的过渡（否则会滑一段），实际 ' + actor.props.style.transitionDuration);

  // ② 宿主回传落点（我们自己写下去的那一版）→ 不许再产生第二段位移
  pig.pos = { x: 50, y: 50 };
  await plugin.__test.place(pig.id, 'pen');
  await render(main);
  tree = await render(main);
  actor = findByClass(tree, 'pighub-actor')[0];
  assert.deepEqual([actor.props.style.left, actor.props.style.top], ['50%', '50%'],
    '宿主回传的落点就是我们站着的点，不许再滑一段，实际 ' + JSON.stringify([actor.props.style.left, actor.props.style.top]));

  // ③ 护栏：外部**真的**改了位置（既不是我们写下去的、也不是上次见到的）仍然要被采纳并平滑走
  pig.pos = { x: 70, y: 60 };
  await plugin.__test.place(pig.id, 'pen');
  await render(main);
  tree = await render(main);
  actor = findByClass(tree, 'pighub-actor')[0];
  assert.deepEqual([actor.props.style.left, actor.props.style.top], ['70%', '60%'],
    '外部改的位置仍要采纳（否则另一个窗口/桌宠回圈就废了），实际 ' + JSON.stringify([actor.props.style.left, actor.props.style.top]));
  assert.ok(Number(String(actor.props.style.transitionDuration).replace('ms', '')) > 0,
    '外部改的位置要平滑走过去（不是瞬移），实际 ' + actor.props.style.transitionDuration);

  pig.pos = backup;
  await plugin.__test.place(pig.id, 'pen');
  await new Promise((r) => setTimeout(r, 10));
});

check('拖动中的猪隐藏本体（不许"拖起来原地还有一个"）', async () => {
  const tree = await render(main);
  const actor = actorImg(tree);
  const capture = { setPointerCapture() {}, releasePointerCapture() {} };
  actor.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  actor.props.onPointerMove({ clientX: 360, clientY: 320 });
  const during = await render(main);
  const hidden = findByClass(during, 'pighub-actor').filter((w) => String(w.props.className).indexOf('is-hidden') >= 0);
  assert.equal(hidden.length, 1, '拖动中本体应带 is-hidden');
  actor.props.onPointerUp({ clientX: 900, clientY: 700 });
  await new Promise((r) => setTimeout(r, 20));
});

check('拖动优先：不许连带选中文字（面板禁选 + 全局拖动态 + preventDefault）', () => {
  // ① 样式：面板与桌宠层不参与文本选择，拖动期间再给 body 挂 !important 级别的禁选
  const css = styles[0].textContent;
  assert.ok(css.indexOf('.pighub-panel,.pighub-pets{user-select:none') >= 0, '面板与桌宠层要禁选');
  assert.ok(css.indexOf('body.pighub-dragging') >= 0, '拖动期间要有全局禁选态');
  // ② 行为：指针按下必须 preventDefault，否则浏览器会开始选区/原生拖图
  const tree = main({});
  const actor = findByClass(tree, 'pighub-actor')[0];
  assert.ok(actor, '面板里应有猪');
  const img = collect(actor).find((x) => typeof x === 'object' && x.type === 'img');
  let prevented = 0;
  img.props.onPointerDown({ button: 0, pointerId: 1, clientX: 10, clientY: 10, currentTarget: { setPointerCapture() {} }, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1, '猪本体 pointerdown 必须 preventDefault');
});

check('游走模型逐参数对齐 pet-window.cs：每个常量都从桌宠源码里读出来比对，而不是把数字抄两遍', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const cs = readFileSync(new URL('../lib/native/pet-window.cs', import.meta.url), 'utf8');
  const M = plugin.__test;
  const grab = (re, what) => {
    const m = re.exec(cs);
    assert.ok(m, 'pet-window.cs 里找不到「' + what + '」——桌宠侧的结构变了，猪圈这边必须跟着改，而不是碰巧数字还对');
    return m;
  };
  // ① 决策间隔（cs:230 / 229）
  const decision = grab(/pet\.NextDecision = now \+ (\d+);/, '决策间隔');
  assert.equal(M.DECISION_MS, Number(decision[1]), '决策间隔要和桌宠一致（cs:230）');
  // ② 发呆概率（cs:232）
  const idle = grab(/if \(Unity < ([\d.]+)\)/, '发呆概率');
  assert.equal(M.IDLE_CHANCE, Number(idle[1]), '发呆概率要和桌宠一致（cs:232）');
  // ③ 单步 = pet.Size * (a + b * Unity)（cs:234）
  const step = grab(/pet\.Size \* \(([\d.]+)f \+ ([\d.]+)f \* \(float\)Unity\)/, '单步距离');
  assert.equal(M.STEP_MIN_BODY, Number(step[1]), '步长下限 = cs:234 的常数项');
  assert.equal(M.STEP_MAX_BODY, Number(step[1]) + Number(step[2]), '步长上限 = 常数项 + 系数（cs:234）');
  // ④ 方向：angle = Unity * PI * 2（cs:233）
  grab(/double angle = Unity \* Math\.PI \* 2;/, '方向');
  // ⑤ 速度 = Size × 系数 × (帧长/1000)（cs:244；帧长来自 cs:101 的 Timer）
  const speed = grab(/float speed = pet\.Size \* ([\d.]+)f \* \((\d+)f \/ (\d+)f\);/, '移动速度');
  const frame = grab(/timer\.Interval = (\d+);/, '帧间隔');
  assert.equal(Number(speed[2]), Number(frame[1]), '速度里的帧长必须与 Timer.Interval 是同一个数');
  assert.equal(Number(speed[3]), 1000, '速度是「像素/毫秒 × 尺寸」，分母应为 1000');
  assert.equal(M.SPEED_BODY_PER_S, Number(speed[1]), '每秒几个身位（cs:244 的系数）');
  assert.equal(M.WALK_PX_PER_S, M.PIG_PX * M.SPEED_BODY_PER_S, '每秒像素 = 身位 × 速度系数');
  // ⑥ 一窗上限：下一次决策（cs:230）会打断走路，所以每段位移 ≤ 速度 × 决策间隔
  assert.ok(Math.abs(M.STEP_CAP_BODY - M.SPEED_BODY_PER_S * (M.DECISION_MS / 1000)) < 1e-9,
    '一窗位移上限的推导不对：' + M.STEP_CAP_BODY);
  // ⑦ 朝向：dx > 0（cs:248）；相等时朝左＝素材默认朝向
  grab(/pet\.FacingRight = dx > 0;/, '朝向规则');
  assert.equal(M.facingFor(50, 51), 'right', '向右走要镜像');
  assert.equal(M.facingFor(50, 49), 'left', '向左走用素材原朝向');
  assert.equal(M.facingFor(50, 50), 'left', '原地（dx = 0）时朝左，与桌宠一致');
  // ⑧ 边界：每帧 clamp（cs:249-251），不是反弹
  grab(/pet\.X = Math\.Max\(area\.Left, Math\.Min\(area\.Right - pet\.Size, pet\.X\)\);/, '左右边界夹取');
  grab(/pet\.Y = Math\.Max\(area\.Top, Math\.Min\(area\.Bottom - pet\.Size, pet\.Y\)\);/, '上下边界夹取');
  assert.equal(M.clampTo(5, 10, 20), 10, '夹取下限');
  assert.equal(M.clampTo(25, 10, 20), 20, '夹取上限');
  assert.equal(M.clampTo(15, 10, 20), 15, '区间内不动');
  assert.ok(source.indexOf('function bounce(') < 0, '镜面反弹应按桌宠口径移除（cs:249-251 是夹取）');
  // ⑨ 松手后原地站稳（cs:397 的 6000）
  const settle = grab(/dropped\.NextDecision = DateTime\.UtcNow\.Ticks \/ 10000 \+ (\d+);/, '松手站稳时长');
  assert.equal(M.SETTLE_MS, Number(settle[1]), '松手站稳时长要和桌宠一致（cs:397）');
  // ⑩ 拖动中不走（cs:203 / cs:228 / cs:376）
  grab(/if \(!pet\.Motion \|\| pet == dragging\) \{ pet\.Walking = false; return; \}/, '拖动暂停');
  assert.ok(source.indexOf('draggingId === pig.id') >= 0, '猪圈这边也要在拖动时停掉游走');
  // ⑪ 走动时的上下起伏幅度（cs:266 的 0.12 个身位）
  const hop = grab(/hop = pet\.Walking[^;]*pet\.Size \* ([\d.]+)f/, '走动起伏幅度');
  const hopPct = Math.round(Number(hop[1]) * 100);
  assert.ok(source.indexOf('translate:0 -' + hopPct + '%') >= 0,
    'CSS 位移弧的幅度应是 ' + hopPct + '% 个身高（cs:266）');
  // ⑫ 节拍：按上一次到期点顺延，节拍照旧 1700（cs:230 的 now + 1700）
  assert.equal(M.nextDecisionAt(1000, 1200), 2900, '准点时应顺延一个决策间隔');
  assert.equal(M.nextDecisionAt(1250, 1200), 2900, '迟到 50ms 不能把节拍拖成 1750ms');
  assert.equal(M.nextDecisionAt(9000, 1200), 10700, '掉队超过一拍才从现在起算（不补拍）');
  // ⑬ 恒速：walkMs = 距离 ÷ 1 身位/秒，且不超过一个决策间隔
  let from = { x: 50, y: 50 };
  for (let i = 0; i < 200; i += 1) {
    const d = M.penDecide(from, M.PIG_PX);
    if (!d.walk) continue;
    const bodies = Math.hypot(d.x - from.x, d.y - from.y) / M.penBodyPct(M.PIG_PX);
    assert.ok(Math.abs(d.walkMs - Math.round(bodies / M.SPEED_BODY_PER_S * 1000)) <= 1,
      'walkMs 必须 = 距离 ÷ 速度，实测 ' + d.walkMs + ' / 应为 ' + Math.round(bodies * 1000));
    assert.ok(d.walkMs <= M.DECISION_MS, '一段走完不该超过一个决策间隔，实测 ' + d.walkMs);
    from = { x: d.x, y: d.y };
  }
});

check('列表筛选：库存单独一档，空库存给空态文案', async () => {
  const tree = await render(main);
  const filters = findByClass(tree, 'pighub-filter');
  assert.equal(filters.length, 4, '应有 全部 / 猪圈 / 桌宠 / 库存 四档，实际 ' + filters.length);
  assert.ok(textOf(filters[3]).indexOf('库存') >= 0, '第四档必须是库存');
  filters[3].props.onClick();
  const after = await render(main);
  assert.ok(textOf(after).indexOf('库存是空的') >= 0, '库存为空时应有空态文案');
  findByClass(after, 'pighub-filter')[0].props.onClick();
  await render(main);
});

await acheck('右键猪本体与列表行：可以配置「允许运动 / 保持静止」', async () => {
  const tree = await render(main);
  const actor = findByClass(tree, 'pighub-actor')[0];
  assert.equal(typeof actor.props.onContextMenu, 'function', '猪本体要能右键');
  let prevented = false;
  actor.props.onContextMenu({ preventDefault() { prevented = true; }, clientX: 20, clientY: 30 });
  assert.equal(prevented, true, '要吃掉浏览器默认右键菜单');
  const opened = await render(main);
  const menu = findByClass(opened, 'pighub-menu');
  assert.equal(menu.length, 1, '右键后应出现行为菜单');
  const buttons = collect(menu[0]).filter((x) => typeof x === 'object' && x.type === 'button');
  const labels = buttons.map((b) => textOf(b)).join('|');
  assert.ok(labels.indexOf('允许运动') >= 0 && labels.indexOf('保持静止') >= 0, '菜单要有两个选项：' + labels);
  const still = buttons.find((b) => textOf(b).indexOf('保持静止') >= 0);
  still.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(requests.some((r) => r.body.action === 'motion' && r.body.motion === false), '点「保持静止」应发出 motion=false');
  const row = findByClass(await render(main), 'pighub-row')[0];
  assert.equal(typeof row.props.onContextMenu, 'function', '列表行也要能右键');
});

await acheck('图鉴：列出池子全部猪猪，未获取的压暗 + 名字是「？？？」', async () => {
  const tree = await render(main);
  const btn = collect(tree).find((x) => x && x.type === 'button' && collect(x).filter((c) => typeof c === 'string').join('') === '图鉴');
  assert.ok(btn, '应有图鉴按钮');
  btn.props.onClick();
  const open = await render(main);
  const cells = findByClass(open, 'pighub-gallery-cell');
  assert.ok(cells.length > 0, '图鉴应至少有一格');
  const locked = cells.filter((c) => String(c.props.className).indexOf('is-locked') >= 0);
  assert.ok(locked.length > 0, '未获取的猪应有 is-locked 态');
  const lockedText = collect(locked[0]).filter((x) => typeof x === 'string').join('');
  assert.ok(lockedText.indexOf('？？？') >= 0, '未获取的名字必须打码成 ？？？，实际 ' + lockedText);
  const owned = cells.filter((c) => String(c.props.className).indexOf('is-locked') < 0);
  assert.ok(owned.length > 0, '已获取的猪应正常显示');
  btn.props.onClick();
});
await acheck('设置按钮在面板右上角，三档星级显示可切换', async () => {
  const tree = await render(main);
  const settings = findByClass(tree, 'pighub-settings');
  assert.equal(settings.length, 1, '面板应有设置按钮容器');
  const button = collect(settings[0]).find((x) => typeof x === 'object' && x.type === 'button');
  assert.ok(button, '缺少设置按钮');
  assert.equal(button.props['aria-label'], 'PigHub 设置');
  // 展开后应看到三档
  const opened = await render(main);
  const button2 = collect(findByClass(opened, 'pighub-settings')[0]).find((x) => typeof x === 'object' && x.type === 'button');
  button2.props.onClick();
  const expanded = await render(main);
  const pop = findByClass(expanded, 'pighub-pop');
  assert.equal(pop.length, 1, '点开后应出现设置浮层');
  const labels = textOf(pop[0]);
  assert.ok(labels.indexOf('关闭') >= 0 && labels.indexOf('默认') >= 0 && labels.indexOf('常驻') >= 0, '缺少三档：' + labels);
  assert.ok(labels.indexOf('素材库') >= 0, '设置里应显示冻结素材库版本');
  assert.ok(labels.indexOf('2026.11.12') >= 0, '应显示 assetVersion');
});

await acheck('不运动的猪静止、会动的猪走动：class 与行为都分开', async () => {
  const tree = await render(main);
  const wrappers = findByClass(tree, 'pighub-actor');
  assert.equal(wrappers.length, 2);
  const dead = wrappers.filter((w) => String(w.props.className).indexOf('is-static') >= 0);
  const live = wrappers.filter((w) => String(w.props.className).indexOf('is-static') < 0);
  assert.equal(dead.length, 1, '不允许运动的猪应带 is-static（无动画）');
  assert.equal(live.length, 1, '会动的猪应带 is-walk/is-idle');
  const deadImg = collect(dead[0]).find((x) => typeof x === 'object' && x.type === 'img');
  assert.ok(deadImg.props.title.indexOf('保持静止') > 0, '静止猪的提示里应写明判定：' + deadImg.props.title);
  assert.ok(deadImg.props.title.indexOf('右键可改运动') > 0, '提示里要告诉用户右键能改：' + deadImg.props.title);
  // 点击只对会动的猪生效：静止猪没有 onClick
  assert.equal(typeof deadImg.props.onClick, 'undefined', '静止猪不该响应点击');
  const liveImg = collect(live[0]).find((x) => typeof x === 'object' && x.type === 'img');
  assert.equal(typeof liveImg.props.onClick, 'function', '活猪点击应有弹性动画');
  liveImg.props.onClick();
  const after = await render(main);
  const squished = findByClass(after, 'is-squish');
  assert.equal(squished.length, 1, '点击后应出现 is-squish');
});

await acheck('清单不再标活死、标出静止态与位置，抽到的猪带切分参数', async () => {
  const tree = await render(main);
  const text = textOf(tree);
  // 用户口径：「列表不标记活死猪」。会动/静止是行为开关，只在「静止」时给一个提示性标签。
  assert.ok(text.indexOf('死猪') < 0 && text.indexOf('活猪') < 0, '清单不该再出现死猪/活猪字样：' + text.slice(0, 200));
  assert.ok(text.indexOf('静止') >= 0, '不允许运动的猪应标「静止」');
  // 素材是包内文件：渲染地址必须是静态路由，且运行时不发起任何图片请求。
  const requests = globalThis.__requests || [];
  assert.equal(requests.some((r) => String(r.url).indexOf('/pighub/image') >= 0), false, '不应再走图片代理');
});

/* ------------------------------------------------------- 抽卡演出（2026-11-14） */
check('演出时间轴：中心放大 1.8 倍、停留 2.5 秒、描述截断 60 字', () => {
  const M = plugin.__test;
  const t = M.revealTimeline();
  assert.equal(t.centerScale, 1.8, '飞到中心要放大 1.8 倍');
  assert.equal(t.holdMs, 2500, '中心停留应为 2500ms');
  assert.ok(t.holdMs >= 2400, '停留时长不得短于 2.4s，实测 ' + t.holdMs);
  assert.equal(t.holdEnd - t.holdStart, t.holdMs, '停留窗口必须正好是 holdMs');
  assert.ok(t.holdStart > t.popMs, '停留必须在弹出与飞入之后');
  assert.ok(t.doneAt > t.holdEnd + t.flyMs, '撤层必须在「飞回」那一段之后');
  assert.equal(t.descMax, 60, '描述截到 60 字');
  const css = styles[0].textContent;
  assert.ok(css.indexOf('.pighub-reveal-card{') >= 0, '缺少演出卡片样式');
  assert.ok(css.indexOf('rgba(22,20,18,.78)') >= 0, '卡片底色应是深色半透明');
  assert.ok(css.indexOf('border-radius:14px') >= 0, '卡片要圆角');
  assert.ok(css.indexOf('.pighub-reveal-name{') >= 0 && css.indexOf('font-weight:700') >= 0, '名字必须粗体');
  assert.ok(css.indexOf('.pighub-reveal-desc{') >= 0 && css.indexOf('font-size:12px') >= 0, '描述必须是小字');
  // 演出层不拦交互：pointer-events:none + 跳过靠 document 监听（不盖一层吃点击的遮罩）
  assert.ok(css.indexOf('.pighub-reveal{position:fixed;left:0;top:0;z-index:60;pointer-events:none') >= 0,
    '演出层不得拦截指针事件');
});

check('描述取 note：超长截到 60 字 + 省略号，没有就留空（不编造）', () => {
  const M = plugin.__test;
  assert.equal(M.describePig({ note: '  圆胖全身、闭眼微笑  ' }), '圆胖全身、闭眼微笑', '应去掉首尾空白');
  assert.equal(M.describePig({}), '', '没有 note 时不得编造描述');
  assert.equal(M.describePig(null), '');
  const cut = M.describePig({ note: '猪'.repeat(80) });
  assert.equal(cut.length, 61, '截断后应是 60 字 + 省略号，实际 ' + cut.length);
  assert.equal(cut.charAt(60), '\u2026');
});

await acheck('抽卡演出：飞到窗口中心 1.8 倍 → 停留显示名字+描述 → 飞回猪圈后撤层', async () => {
  const M = plugin.__test;
  const t = M.revealTimeline();
  const landOffset = 66;                 // REVEAL_SIZE / 2
  const cx = window.innerWidth / 2;      // 1280 / 2 = 640（窗口中心，不是猪圈中心）
  const cy = window.innerHeight / 2;     // 800 / 2 = 400
  const pen = { x: 200 + 400 / 2, y: 200 + 400 / 2 };   // 前面注入的猪圈矩形，中心 (400,400)
  assert.notEqual(cx, pen.x, '窗口中心必须与猪圈中心不同，否则这条断言没有区分力');

  const draw = findByClass(await render(main), 'pighub-draw')[0];
  assert.ok(draw, '缺少「今日猪猪」按钮——演出就是从这里起飞的');
  const started = Date.now();
  const waitUntil = async (ms) => {
    const left = ms - (Date.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  };
  await draw.props.onClick();

  // ① 飞行中：已经在去窗口中心的路上（1.8 倍），卡片还没出现
  await waitUntil(t.popMs + 180);
  const flying = await render(main);
  const flight = findByClass(flying, 'pighub-reveal');
  assert.equal(flight.length, 1, '起飞后应有演出元素，实际 ' + flight.length);
  const flightTransform = String(flight[0].props.style.transform);
  assert.ok(flightTransform.indexOf('translate3d(' + (cx - landOffset) + 'px,' + (cy - landOffset) + 'px,0)') >= 0,
    '飞行目标应是窗口中心，实际 ' + flightTransform);
  assert.ok(flightTransform.indexOf('scale(1.8)') >= 0, '飞到中心要放大到 1.8 倍，实际 ' + flightTransform);
  assert.equal(findByClass(flying, 'pighub-reveal-card').length, 0, '飞行中不该有卡片');

  // ② 停留中：卡片亮着，名字 + 描述都在，位置压在猪头顶上方（不遮挡猪）
  await waitUntil(t.holdStart + 150);
  const holding = await render(main);
  const card = findByClass(holding, 'pighub-reveal-card');
  assert.equal(card.length, 1, '停留期必须出现卡片');
  assert.ok(String(card[0].props.className).indexOf('is-hold') >= 0, '停留期卡片应带 is-hold（淡入态）');
  const cardText = textOf(card[0]);
  assert.ok(cardText.indexOf('丙猪') >= 0, '卡片要有名字，实际 ' + cardText);
  assert.ok(cardText.indexOf('圆胖全身、闭眼微笑') >= 0, '卡片要有描述（manifest 的 note），实际 ' + cardText);
  const pigHalf = (132 * 1.8) / 2;
  const cardTop = parseFloat(card[0].props.style.top);
  assert.ok(Number.isFinite(cardTop), '卡片 top 应是数值像素，实际 ' + card[0].props.style.top);
  assert.ok(cardTop <= cy - pigHalf - 11.9, '卡片必须压在猪头顶上方，不遮挡猪：top=' + cardTop + ' / 猪顶=' + (cy - pigHalf));
  const still = String(findByClass(holding, 'pighub-reveal')[0].props.style.transform);
  assert.ok(still.indexOf('scale(1.8)') >= 0, '停留期保持 1.8 倍，实际 ' + still);

  // ③ 停留结束 → 飞回猪圈落位：目标换成猪圈中心、缩放回 0.56，卡片撤掉 is-hold（开始淡出）
  await waitUntil(t.holdEnd + 150);
  const back = await render(main);
  const backTransform = String(findByClass(back, 'pighub-reveal')[0].props.style.transform);
  assert.ok(backTransform.indexOf('translate3d(' + (pen.x - landOffset) + 'px,' + (pen.y - landOffset) + 'px,0)') >= 0,
    '回归落点应是猪圈，实际 ' + backTransform);
  assert.ok(backTransform.indexOf('scale(0.56)') >= 0, '落到猪圈要缩回 0.56 倍，实际 ' + backTransform);
  const fading = findByClass(back, 'pighub-reveal-card');
  assert.equal(fading.length, 1, '回归途中卡片还在（淡出，而不是瞬间消失）');
  assert.ok(String(fading[0].props.className).indexOf('is-hold') < 0, '回归时卡片应撤掉 is-hold 开始淡出');

  // ④ 落定后撤层：演出元素与卡片都不再渲染
  await waitUntil(t.doneAt + 220);
  const done = await render(main);
  assert.equal(findByClass(done, 'pighub-reveal').length, 0, '演出结束后不该还有演出元素');
  assert.equal(findByClass(done, 'pighub-reveal-card').length, 0, '演出结束后不该还有卡片');
});

await acheck('演出可点击跳过：document 上的 pointerdown 立刻收场（不拦其它交互）', async () => {
  const M = plugin.__test;
  const draw = findByClass(await render(main), 'pighub-draw')[0];
  await draw.props.onClick();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(findByClass(await render(main), 'pighub-reveal').length, 1, '应正在演出');
  const listeners = documentStub.listeners.pointerdown || [];
  assert.ok(listeners.length > 0, '演出期间应在 document 上挂一个「点任意处跳过」的监听');
  // 模拟「点任意处」：只调这一个回调，和浏览器的捕获阶段一致（不 preventDefault、不阻断）
  listeners[listeners.length - 1]({ type: 'pointerdown' });
  const after = await render(main);
  assert.equal(findByClass(after, 'pighub-reveal').length, 0, '点一下应立刻收场');
  assert.equal(findByClass(after, 'pighub-reveal-card').length, 0, '收场时卡片也一起撤掉');
});

await acheck('减少动画偏好：不飞，直接显示卡片停 2.5 秒，猪圈里那只不隐藏', async () => {
  const M = plugin.__test;
  const original = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  try {
    assert.equal(M.prefersReducedMotion(), true, '现问一次偏好，而不是吃模块加载时的那次快照');
    const draw = findByClass(await render(main), 'pighub-draw')[0];
    await draw.props.onClick();
    await new Promise((r) => setTimeout(r, 120));
    const shown = await render(main);
    const card = findByClass(shown, 'pighub-reveal-card');
    assert.equal(card.length, 1, '减少动画时应直接显示卡片');
    assert.ok(String(card[0].props.className).indexOf('is-hold') >= 0, '卡片应直接是亮着的状态');
    assert.equal(findByClass(shown, 'pighub-reveal').length, 0, '减少动画时不做飞行：不该有飞行元素');
    assert.ok(textOf(card[0]).indexOf('丙猪') >= 0, '卡片仍要有名字');
    assert.ok(textOf(card[0]).indexOf('圆胖全身、闭眼微笑') >= 0, '卡片仍要有描述');
    const hidden = findByClass(shown, 'pighub-actor').filter((w) => String(w.props.className).indexOf('is-hidden') >= 0);
    assert.equal(hidden.length, 0, '减少动画时猪圈里那只不该被藏起来');
    await new Promise((r) => setTimeout(r, M.revealTimeline().holdMs + 250));
    const gone = await render(main);
    assert.equal(findByClass(gone, 'pighub-reveal-card').length, 0, '停留 2.5 秒后卡片应自己消失');
  } finally {
    window.matchMedia = original;
  }
});

/*
 * 「桌宠回猪圈」那 8 秒空窗的回归线（2026-11-14）。
 * 机制：原生桌宠是宿主/另一个进程在改 place，浏览器半只能靠轮询知道；原来只有 10 s 一轮整张快照，
 * 实测空窗 0.16–8.36 s、两次相隔 1.1 s 的动作隔 10.03 s 才落地
 *（archive/20261114-135230-pet-return-continuity）。现在桌宠在场时 250 ms 问一次令牌。
 */
check('对账节奏：桌宠在场 250 ms 令牌、空闲 1 s 令牌，整张快照 10 s 兜底', () => {
  const M = plugin.__test;
  assert.equal(M.WATCH_MS, 250, '桌宠在场时的对账间隔（实测桌宠消失 205±4 ms，取略大于它）');
  assert.equal(M.IDLE_WATCH_MS, 1000, '空闲时的令牌间隔：再慢就发现不了"有猪出门"，而那时才切到 250 ms');
  assert.equal(M.FULL_POLL_MS, 10000, '整张快照的兜底间隔（位置不进令牌，只能靠它对账）');
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(/setInterval\(async \(\) => \{/.test(source), '没找到桌宠层的对账 tick');
  assert.ok(source.indexOf('data.desktopPet && data.desktopPet.running') >= 0, 'tick 必须看原生桌宠在不在');
  assert.ok(source.indexOf('await STORE.syncRev();') >= 0, 'tick 必须走令牌对账');
  assert.ok(/if \(now - lastFullPollRef\.current >= FULL_POLL_MS\)/.test(source),
    '整张快照必须有一条无条件的 10 s 兜底：位置不进令牌，老宿主也没有 rev 动作');
  // 原来那行「每 10 s 无条件拉整张快照」必须已经不在（它就是这个 bug 的来源）
  assert.ok(source.indexOf('STORE.load().catch(() => {}); }, 10000)') < 0, '10 s 无条件整张快照的写法应已移除');
});

await acheck('令牌对账：没变只问一句，变了立刻拉整张快照并 apply', async () => {
  const syncRev = plugin.__test.syncRev;
  assert.equal(typeof syncRev, 'function', '__test 要暴露 syncRev（定时器在结构测试里是空实现）');
  const start = requests.length;
  globalThis.__rev.set('rev-A');
  await syncRev();
  assert.deepEqual(requests.slice(start).map((r) => r.body.action), ['rev', 'state'],
    '第一次看到新令牌 → 先问令牌，再拉一次快照');
  assert.deepEqual(Object.keys(requests[start].body), ['action'], '令牌请求不许带负载（只花几十字节）');
  const state = plugin.__test.storeState();
  assert.ok(state && state.data && Array.isArray(state.data.pigs), '快照要真的 apply 进 store（data.pigs 就位）');

  const same = requests.length;
  await syncRev();
  assert.deepEqual(requests.slice(same).map((r) => r.body.action), ['rev'],
    '令牌没变 → 一次快照都不许拉（否则等于又回到 10 s 一变 4 次的整张快照）');

  globalThis.__rev.set('rev-B');
  await syncRev();
  assert.deepEqual(requests.slice(same).map((r) => r.body.action), ['rev', 'rev', 'state'],
    '令牌变了 → 立刻拉快照（这一条就是「双击回圈后猪圈里空着」的修复）');
});

await acheck('插件重载瞬间的失败不能让客户端永久降级（否则空窗又变回几秒）', async () => {
  const syncRev = plugin.__test.syncRev;
  globalThis.__rev.set('boom');
  const start = requests.length;
  assert.equal(await syncRev(), true, '一次 500 只该当作"这一拍不算数"，不该回 false');
  globalThis.__rev.set('rev-C');
  await syncRev();
  assert.deepEqual(requests.slice(start).map((r) => r.body.action), ['rev', 'rev', 'state'],
    '恢复之后必须还能正常对账并拉快照（没被锁死）');
});

await acheck('老宿主没有 rev 动作：对账回 false（让 tick 退回 10 s 整张快照），且不再反复问', async () => {
  const syncRev = plugin.__test.syncRev;
  globalThis.__rev.set(null);
  const start = requests.length;
  assert.equal(await syncRev(), false, '宿主不支持 rev 时必须回 false，否则 tick 会一直停在令牌分支、一次快照都不拉');
  assert.deepEqual(requests.slice(start).map((r) => r.body.action), ['rev'], '这一拍只问一次，不改拉快照');
  assert.equal(await syncRev(), false, '降级标记是粘性的');
  assert.deepEqual(requests.slice(start).map((r) => r.body.action), ['rev'], '降级之后连 rev 都不再问（不刷 250 ms 的错误）');
});

/* ------------------------------------- 猪之间的遮挡：按脚底排序（2026-11-14 用户口径「下遮挡上」） */
await acheck('脚底 = 中心 y + 渲染高度/2（高度按 sizeRatio × aspect 算，不拿 top 当脚底）', async () => {
  const M = plugin.__test;
  const penW = M.penWidthPx();   // 当前的猪圈宽度（penRect 量到过就用实测值，否则 451 兜底）
  const proto = { sizeRatio: 96, aspect: 1 };
  // 猪圈是 1:1，所以「宽占百分之几」就是「高占百分之几」：96 / 猪圈宽 × 100，一半 = 脚底相对中心的下沉量。
  const heightPct = (96 / penW) * 100;
  assert.ok(Math.abs(M.penActorHeightPct(proto) - heightPct) < 1e-9,
    '渲染高度百分比错了：' + M.penActorHeightPct(proto));
  assert.ok(Math.abs(M.penFootPct({ y: 50 }, proto) - (50 + heightPct / 2)) < 1e-9,
    '脚底必须是「中心 + 半个渲染高度」，不是中心本身：' + M.penFootPct({ y: 50 }, proto));
  // aspect 必须真的参与：同宽、更扁（更高）的贴图，脚底更低 —— 这就是「贴图底部即脚底」的意思
  const taller = { sizeRatio: 96, aspect: 1.3 };
  assert.ok(M.penActorHeightPct(taller) > M.penActorHeightPct(proto), 'aspect 没参与高度计算');
  assert.ok(M.penFootPct({ y: 50 }, taller) > M.penFootPct({ y: 50 }, proto),
    '更扁的贴图渲染得更高，脚底必须更低：' + M.penFootPct({ y: 50 }, taller) + ' vs ' + M.penFootPct({ y: 50 }, proto));
  // 同一 foot 的两只、不同 sizeRatio 时，中心 y 不同 —— 说明是**脚底**在排序，不是 top 在排序
  const big = { sizeRatio: 140, aspect: 1 };
  assert.ok(M.penFootPct({ y: 40 }, big) > M.penFootPct({ y: 45 }, proto),
    '大猪中心更高但脚底更低时，必须按脚底算（否则拖拽大猪会插到小猪后面）');
  assert.ok(Number.isFinite(M.penFootPct({ y: 30 }, {})), '缺 sizeRatio/aspect 也要给出有限值，不许 NaN');
});

await acheck('z 名次：脚底越低 z 越大、整档夹在小屋与近栏之间、同脚底按 id 稳定、拖动在最上', async () => {
  const M = plugin.__test;
  const pigs = [{ id: 'pighub-30' }, { id: 'pighub-10' }, { id: 'pighub-20' }, { id: 'pighub-40' }];
  // 高度一致（缺 sizeRatio/aspect → 回落到 PIG_PX / 1），所以顺序只看 y：
  // 脚底从上到下 = 30(20%) < 10(40%) < 20(60%) < 40(80%)
  const actors = { 'pighub-30': { y: 20 }, 'pighub-10': { y: 40 }, 'pighub-20': { y: 60 }, 'pighub-40': { y: 80 } };
  const z = M.penZIndexMap(pigs, actors, null);
  const seq = ['pighub-30', 'pighub-10', 'pighub-20', 'pighub-40'].map((id) => z[id]);
  for (let i = 1; i < seq.length; i += 1) {
    assert.ok(seq[i - 1] < seq[i], '脚底越低 z 必须越大（严格单调）：' + JSON.stringify(z));
  }
  for (const id of Object.keys(z)) {
    assert.ok(z[id] >= M.Z_ACTOR_MIN && z[id] <= M.Z_ACTOR_MAX, 'z 跑出档位了：' + id + '=' + z[id]);
    assert.ok(z[id] > M.Z_HOUSE, '猪必须压在小屋之上：' + id + '=' + z[id]);
    assert.ok(z[id] < M.Z_FENCE_FRONT, '猪不许压过近栏：' + id + '=' + z[id]);
  }
  // 同脚底 → 由 id 决定（与这一帧的渲染次序无关，所以不会两帧之间抢层、闪烁）
  const tie = M.penZIndexMap([{ id: 'pighub-9' }, { id: 'pighub-1' }],
    { 'pighub-9': { y: 50 }, 'pighub-1': { y: 50 } }, null);
  assert.ok(tie['pighub-1'] < tie['pighub-9'], '同脚底必须按 id 稳定排序：' + JSON.stringify(tie));
  // 拖动中的猪取这一档最上：拖起来不能被别的猪挡住
  const drag = M.penZIndexMap(pigs, actors, 'pighub-30');
  assert.ok(drag['pighub-30'] > drag['pighub-40'], '拖动中的猪必须在最上：' + JSON.stringify(drag));
  assert.ok(drag['pighub-30'] <= M.Z_ACTOR_MAX && drag['pighub-30'] < M.Z_FENCE_FRONT,
    '拖动中的猪也不许压过近栏：' + JSON.stringify(drag));
  assert.ok(drag['pighub-10'] < drag['pighub-20'] && drag['pighub-20'] < drag['pighub-40'],
    '把拖动那只拎到最上之后，其余三只的相对顺序不许变：' + JSON.stringify(drag));
  // 满圈（12 只，猪圈容量）也不越界，且 12 只拿到 12 个不同 z（没有两个对子分不出前后）
  const full = [];
  const fullActors = {};
  for (let i = 0; i < 12; i += 1) {
    full.push({ id: 'pighub-' + (100 + i) });
    fullActors['pighub-' + (100 + i)] = { y: 10 + i * 6 };
  }
  const zFull = M.penZIndexMap(full, fullActors, null);
  const values = Object.keys(zFull).map((key) => zFull[key]);
  assert.equal(new Set(values).size, 12, '12 只猪必须拿到 12 个不同的 z：' + JSON.stringify(zFull));
  assert.ok(Math.max.apply(null, values) <= M.Z_ACTOR_MAX, '满圈也不许越过档位上限：' + Math.max.apply(null, values));
});

await acheck('渲染：z 写在内联 style 上、落在档内、绘制顺序等于脚底顺序', async () => {
  // 先把两只猪摆回猪圈（前面的用例可能把它们中的一只拖成了桌宠）
  await plugin.__test.place('3', 'pen');
  await plugin.__test.place('1', 'pen');
  const tree = await render(main);
  const nodes = findByClass(tree, 'pighub-actor');
  assert.equal(nodes.length, 2, '这一帧猪圈里应有两只猪，实际 ' + nodes.length);
  const rows = nodes.map((node) => {
    const id = node.props['data-pig'];
    const pig = snapshot.pigs.find((item) => item.id === id) || {};
    const y = parseFloat(node.props.style.top);
    return { id, z: node.props.style.zIndex, foot: plugin.__test.penFootPct({ y }, pig) };
  });
  for (const row of rows) {
    assert.equal(typeof row.z, 'number', 'z 必须是内联写的数字（CSS 里那个只是没有内联值时的默认）：' + row.id);
    assert.ok(row.z >= plugin.__test.Z_ACTOR_MIN && row.z <= plugin.__test.Z_ACTOR_MAX,
      '渲染出来的 z 跑出档位了：' + row.id + '=' + row.z);
  }
  const order = rows.slice().sort((a, b) => (a.foot - b.foot) || (a.id < b.id ? -1 : 1));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1].z < order[i].z, '这一帧的绘制顺序必须等于脚底顺序：' + JSON.stringify(rows) + ' → ' + JSON.stringify(order));
  }
  // 名次表读的是**当前这一帧的 actor 状态**，不是挂载时算一次（结构断言：它写在面板组件体里、吃 actors）
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(/const zById = penZIndexMap\(penPigs, actors, /.test(source),
    'z 名次表必须每帧由 penPigs + actors 现算（否则游走/拖动/落地后层级不跟着动）');
});

console.log('\n' + passed + ' PASS / 0 FAIL  —  client bundle structure');