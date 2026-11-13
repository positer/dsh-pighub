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
    { id: '3', title: '丙猪', assetUrl: '/pighub/asset/pig-c.png', kind: 'live', place: 'pen', rarity: 'common', rarityLabel: '普通', stars: 2, firstObtainedAt: '2026-11-12T01:00:00.000Z', lastUpgradedAt: '2026-11-12T02:00:00.000Z' },
    { id: '1', title: '甲猪', assetUrl: '/pighub/asset/pig-a.png', kind: 'dead', place: 'pen', rarity: 'common', rarityLabel: '普通', stars: 1, firstObtainedAt: '2026-11-11T01:00:00.000Z', lastUpgradedAt: '2026-11-11T01:00:00.000Z' },
  ],
  pets: [],
  // 图鉴用：池子里全部猪猪（含未获取）
  pool: [
    { id: '3', title: '丙猪', url: '/pighub/asset/pig-c.png' },
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
globalThis.fetch = async (url, options) => {
  const body = options && options.body ? JSON.parse(options.body) : {};
  requests.push({ url, body });
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
  // 围栏换成**灌木丛**：一张铺满猪圈的 SVG，四条边靠四个 <g transform> 摆位（几何只有一处）。
  // 断的是「结构能不能对上账」，不是像素：两张绿层数量一一对应、四角各一丛更大的、每丛脚下都有影。
  const hedge = findByClass(tree, 'pighub-hedge');
  assert.equal(hedge.length, 1, '应有一张灌木丛 SVG，实际 ' + hedge.length);
  const blobs = findByClass(tree, 'pighub-hedge-blob');
  assert.equal(blobs.length, 48, '前层丛数不对（每条边 11 丛 + 四角各 1 丛），实际 ' + blobs.length);
  assert.equal(findByClass(tree, 'pighub-hedge-back').length, blobs.length, '后层丛数要和前层一一对应');
  assert.equal(findByClass(tree, 'pighub-hedge-corner').length, 4, '四个角要各有一丛更大的');
  assert.equal(findByClass(tree, 'pighub-hedge-cast').length, 44, '每丛脚下都要有接触影（角丛除外）');
  assert.equal(findByClass(tree, 'pighub-hedge-band').length, 4, '四条边各要有一条贴地暗带');
  assert.ok(findByClass(tree, 'pighub-hedge-leaf').length <= 8, '叶点不要超过 8 处（多了会变成花纹布）');
  assert.equal(findByClass(tree, 'pighub-house').length, 1, '缺少仓库小屋');
  const title = collect(tree).filter((x) => typeof x === 'object' && x.props && x.props['aria-label'] === 'PigHub');
  assert.equal(title.length, 1, '缺少像素标题');
  const rects = collect(title[0]).filter((x) => typeof x === 'object' && x.type === 'rect');
  assert.ok(rects.length > 60, '像素标题方块太少：' + rects.length);
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

check('拖动落点在猪圈内 = 换位置（不是取消）', async () => {
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
console.log('\n' + passed + ' PASS / 0 FAIL  —  client bundle structure');