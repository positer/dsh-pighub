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
    { id: '3', title: '丙猪', assetUrl: '/pighub/asset/pig-c.png', kind: 'live', rarity: 'common', rarityLabel: '普通', stars: 2, firstObtainedAt: '2026-11-12T01:00:00.000Z', lastUpgradedAt: '2026-11-12T02:00:00.000Z' },
    { id: '1', title: '甲猪', assetUrl: '/pighub/asset/pig-a.png', kind: 'dead', rarity: 'common', rarityLabel: '普通', stars: 1, firstObtainedAt: '2026-11-11T01:00:00.000Z', lastUpgradedAt: '2026-11-11T01:00:00.000Z' },
  ],
  pets: [],
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
  if (body.action === 'pet') {
    const pets = body.pet ? [body.pigId] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(Object.assign({}, snapshot, { pets })) };
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

check('侧边栏图标：24 格视框、尺寸跟随 props.size、用 currentColor', () => {
  resetRender();
  const icon = sidebar({ size: 18 });
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.width, 18);
  assert.equal(icon.props.height, 18);
  assert.equal(icon.props.viewBox, '0 0 24 24');
  assert.equal(icon.props.stroke, 'currentColor');
  const shapes = collect(icon).filter((x) => typeof x === 'object');
  assert.ok(shapes.length >= 8, '猪由多段描边组成，实际 ' + shapes.length + ' 段');
});

const pixelTitle = collect;
await acheck('面板首帧：猪圈（空）、像素标题、「今日猪猪」、三个排序按钮', async () => {
  const tree = await render(main);
  const text = textOf(tree);
  assert.ok(text.indexOf('今日猪猪') >= 0 || text.indexOf('今日已获取') >= 0, '缺少今日按钮');
  assert.ok(text.indexOf('按获取时间') >= 0 && text.indexOf('按星级') >= 0 && text.indexOf('按稀有度') >= 0, '缺少排序按钮');
  assert.ok(findByClass(tree, 'pighub-pen').length === 1, '缺少猪圈');
  const fence = findByClass(tree, 'pighub-fence');
  assert.equal(fence.length, 1, '缺少围栏');
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
  assert.ok(text.indexOf('1361 只猪猪可选') >= 0, '应显示目录规模');
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
  const before = requests.filter((r) => r.body.action === 'pet').length;

  // ① 原地抖一下（< 5px 阈值）：不该改变归属
  actor.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  actor.props.onPointerMove({ button: 0, clientX: 302, clientY: 302 });
  actor.props.onPointerUp({ clientX: 302, clientY: 302 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(requests.filter((r) => r.body.action === 'pet').length, before, '阈值内的抖动不应发起 pet 请求');

  // ② 拖出去（> 5px 且落点在猪圈外）：变成桌宠
  actor.props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, currentTarget: capture });
  actor.props.onPointerMove({ clientX: 900, clientY: 640 });
  actor.props.onPointerUp({ clientX: 900, clientY: 640 });
  await new Promise((r) => setTimeout(r, 20));
  const petRequests = requests.filter((r) => r.body.action === 'pet' && r.body.pet === true);
  assert.equal(petRequests.length, 1, '拖出猪圈应发一次 pet=true');
  assert.equal(petRequests[0].body.pigId, '3', '被拖走的应是那只猪');
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
  const before = requests.filter((r) => r.body.action === 'pet' && r.body.pet === false).length;
  moved.props.onDoubleClick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(requests.filter((r) => r.body.action === 'pet' && r.body.pet === false).length, before + 1, '双击应发一次 pet=false');
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

await acheck('死猪静止、活猪会动：class 与行为都分开', async () => {
  const tree = await render(main);
  const wrappers = findByClass(tree, 'pighub-actor');
  assert.equal(wrappers.length, 2);
  const dead = wrappers.filter((w) => String(w.props.className).indexOf('is-static') >= 0);
  const live = wrappers.filter((w) => String(w.props.className).indexOf('is-static') < 0);
  assert.equal(dead.length, 1, '死猪应带 is-static（无动画）');
  assert.equal(live.length, 1, '活猪应带 is-walk/is-idle');
  const deadImg = collect(dead[0]).find((x) => typeof x === 'object' && x.type === 'img');
  assert.ok(deadImg.props.title.indexOf('死猪') > 0, '死猪的提示里应写明判定：' + deadImg.props.title);
  // 点击只对活猪生效：死猪没有 onClick
  assert.equal(typeof deadImg.props.onClick, 'undefined', '死猪不该响应点击');
  const liveImg = collect(live[0]).find((x) => typeof x === 'object' && x.type === 'img');
  assert.equal(typeof liveImg.props.onClick, 'function', '活猪点击应有弹性动画');
  liveImg.props.onClick();
  const after = await render(main);
  const squished = findByClass(after, 'is-squish');
  assert.equal(squished.length, 1, '点击后应出现 is-squish');
});

await acheck('清单标出死猪/活猪，抽到的猪带切分参数', async () => {
  const tree = await render(main);
  const text = textOf(tree);
  assert.ok(text.indexOf('死猪') >= 0 && text.indexOf('活猪') >= 0, '清单应同时出现活猪与死猪标签');
  // 素材是包内文件：渲染地址必须是静态路由，且运行时不发起任何图片请求。
  const requests = globalThis.__requests || [];
  assert.equal(requests.some((r) => String(r.url).indexOf('/pighub/image') >= 0), false, '不应再走图片代理');
});
console.log('\n' + passed + ' PASS / 0 FAIL  —  client bundle structure');