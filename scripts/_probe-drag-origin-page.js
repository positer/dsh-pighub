
/* ============================================================
 * 页内探针装置：mini-React + 假宿主 + 指针驱动 + 采样
 * 目的：把真实的 lib/client.js bundle 放进真实浏览器（真实 CSS transition），
 *       用真实 pointer 事件驱动一次「拖放」，按 50ms 采样 actor 的 left/top。
 * 假件只有两样：React（宿主提供）与 /pighub 的 HTTP 应答（宿主提供）。
 * ============================================================ */
(function () {
  var PIG_A = 'pighub-1114';
  var SLEEP = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------------------------------------------------- mini React */
  var instances = new Map();
  var cursor = 0, currentPath = null;
  /* 一棵根 = 一个挂载点。真机上有两个：main（猪圈面板）与 shell.overlay（桌宠层，
   * 轮询对账就住在它的 effect 里——只挂 main 的话那个 10 s 快照永远不会来）。 */
  var ROOTS = [];
  var flushScheduled = false, passEffects = [];
  var renderCount = 0;

  function instOf(path) {
    var i = instances.get(path);
    if (!i) { i = { hooks: [] }; instances.set(path, i); }
    return i;
  }
  function sameDeps(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
    return true;
  }

  function useState(init) {
    var i = instOf(currentPath), idx = cursor++;
    if (!(idx in i.hooks)) i.hooks[idx] = { v: typeof init === 'function' ? init() : init };
    var cell = i.hooks[idx];
    var set = function (value) {
      var next = typeof value === 'function' ? value(cell.v) : value;
      if (Object.is(next, cell.v)) return;
      cell.v = next;
      schedule();
    };
    return [cell.v, set];
  }
  function useRef(init) {
    var i = instOf(currentPath), idx = cursor++;
    if (!(idx in i.hooks)) i.hooks[idx] = { current: init };
    return i.hooks[idx];
  }
  function useEffect(fn, deps) {
    var i = instOf(currentPath), idx = cursor++;
    i.hooks[idx] = i.hooks[idx] || { hasRun: false, deps: undefined, cleanup: null };
    passEffects.push({ path: currentPath, idx: idx, fn: fn, deps: deps || null });
  }
  function useCallback(fn, deps) {
    var i = instOf(currentPath), idx = cursor++;
    var cell = i.hooks[idx];
    if (!cell || !sameDeps(cell.deps, deps)) i.hooks[idx] = { deps: deps || null, value: fn };
    return i.hooks[idx].value;
  }
  function useMemo(fn, deps) {
    var i = instOf(currentPath), idx = cursor++;
    var cell = i.hooks[idx];
    if (!cell || !sameDeps(cell.deps, deps)) i.hooks[idx] = { deps: deps || null, value: fn() };
    return i.hooks[idx].value;
  }

  function createElement(type, props) {
    var children = Array.prototype.slice.call(arguments, 2).flat(9);
    return { type: type, props: props || {}, children: children };
  }

  var MiniReact = {
    createElement: createElement,
    useState: useState, useRef: useRef, useEffect: useEffect,
    useCallback: useCallback, useMemo: useMemo,
  };

  /* React 18 的 useEffect 是**被动 effect**：commit 之后由调度器（MessageChannel）另起一个任务跑，
   * 也就是「先让浏览器画一帧，再跑 effect」。这个差别对本次缺陷是决定性的（commit 里落点被
   * 画出来，effect 再把它搬回去），所以把它做成可切换的两种时序，两种都必须成立。 */
  var EFFECT_MODE = (/[?&]effects=sync/.test(location.search) ? 'sync' : 'async');
  var effectTimer = null;
  function schedule() {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(function () { flushScheduled = false; flushTree(); });
  }
  function scheduleEffects() {
    if (effectTimer != null) return;
    effectTimer = setTimeout(function () { effectTimer = null; runEffects(); }, 0);
  }

  function expand(node, path) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (Array.isArray(node)) return node.map(function (n, i) { return expand(n, path + '/' + i); });
    if (typeof node === 'string' || typeof node === 'number') return { type: '#text', text: String(node) };
    if (typeof node.type === 'function') {
      var prevPath = currentPath, prevCursor = cursor;
      currentPath = path; cursor = 0;
      var out = node.type(Object.assign({}, node.props));
      currentPath = prevPath; cursor = prevCursor;
      return expand(out, path + '.o');
    }
    var kids = (node.children || []).map(function (c, i) { return expand(c, path + '/' + i); });
    return { type: node.type, props: node.props, children: kids.filter(function (x) { return x !== null; }) };
  }

  function applyStyle(el, prev, next) {
    var key;
    for (key in next) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
      if (prev[key] === next[key]) continue;
      var v = next[key];
      if (key.indexOf('--') === 0) el.style.setProperty(key, String(v));
      else el.style[key] = v === null || v === undefined ? '' : String(v);
    }
    for (key in prev) {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) continue;
      if (key in next) continue;
      if (key.indexOf('--') === 0) el.style.removeProperty(key); else el.style[key] = '';
    }
  }

  function applyProps(el, props) {
    var prev = el.__props || {};
    var key, val;
    for (key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      if (key === 'key') continue;
      val = props[key];
      if (key === 'ref') { if (val && typeof val === 'object') val.current = el; continue; }
      if (key === 'className') { if (el.className !== val) el.className = val === null || val === undefined ? '' : String(val); continue; }
      if (key === 'htmlFor') { el.htmlFor = String(val); continue; }
      if (key === 'style') { applyStyle(el, prev.style || {}, val || {}); continue; }
      if (/^on[A-Z]/.test(key)) {
        var evt = key.slice(2).toLowerCase();
        if (el['on' + evt] !== val) el['on' + evt] = val;
        continue;
      }
      if (prev[key] === val) continue;
      if (val === false || val === null || val === undefined) el.removeAttribute(key);
      else el.setAttribute(key, String(val));
    }
    for (key in prev) {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) continue;
      if (key in props) continue;
      if (key === 'ref') continue;
      if (key === 'style') { applyStyle(el, prev.style || {}, {}); continue; }
      if (/^on[A-Z]/.test(key)) { el['on' + key.slice(2).toLowerCase()] = null; continue; }
      el.removeAttribute(key);
    }
    el.__props = props;
  }

  function commitNode(v, dom) {
    if (!v) return dom;
    if (v.type === '#text') {
      if (!dom || dom.nodeType !== 3) { var tn = document.createTextNode(v.text); if (dom) dom.replaceWith(tn); return tn; }
      if (dom.nodeValue !== v.text) dom.nodeValue = v.text;
      return dom;
    }
    if (!dom || dom.nodeType !== 1 || dom.tagName.toLowerCase() !== String(v.type)) {
      var el = document.createElement(v.type);
      if (dom && dom.parentNode) dom.parentNode.replaceChild(el, dom); else if (dom) dom.replaceWith(el);
      dom = el;
    }
    applyProps(dom, v.props);
    var want = v.children.length;
    var have = dom.childNodes.length;
    for (var i = 0; i < want; i += 1) {
      var childDom = commitNode(v.children[i], dom.childNodes[i] || null);
      if (childDom && childDom.parentNode !== dom) dom.appendChild(childDom);
    }
    while (dom.childNodes.length > want) dom.removeChild(dom.lastChild);
    return dom;
  }

  function runEffects() {
    var list = passEffects; passEffects = [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      var e = list[i];
      var inst = instOf(e.path);
      var cell = inst.hooks[e.idx];
      if (cell.hasRun && sameDeps(cell.deps, e.deps)) continue;
      if (typeof cell.cleanup === 'function') { try { cell.cleanup(); } catch (err) { console.error('cleanup', err); } }
      cell.hasRun = true;
      cell.deps = e.deps;
      cell.cleanup = null;
      var ret = e.fn();
      cell.cleanup = typeof ret === 'function' ? ret : null;
    }
  }

  function flushTree() {
    passEffects = [];
    renderCount += 1;
    for (var i = 0; i < ROOTS.length; i += 1) {
      var root = ROOTS[i];
      var vroot = expand({ type: root.component, props: {}, children: [] }, root.key);
      if (!vroot) {
        if (root.dom && root.dom.parentNode) root.dom.parentNode.removeChild(root.dom);
        root.dom = null;
        continue;
      }
      var dom = commitNode(vroot, root.dom || null);
      if (!dom.__mounted) { root.container.appendChild(dom); dom.__mounted = true; }
      root.dom = dom;
    }
    if (EFFECT_MODE === 'sync') runEffects(); else scheduleEffects();
  }

  /* ---------------------------------------------------- 假宿主（/pighub） */
  var ASSETS = window.__PIGHUB_ASSETS__ || {};
  var ASSET_URL = window.__PIGHUB_ASSET_URL__ || '';
  var hostState = {
    pigs: {
      'pighub-1114': {
        id: 'pighub-1114', title: '你是小猪', kind: 'live', motion: true, place: 'pen', stars: 2,
        pos: { x: 30, y: 52 }, posAt: 0,
        assetUrl: ASSET_URL, imageUrl: ASSET_URL, url: ASSET_URL,
        sizeRatio: ASSETS.sizeRatio || 95.32, aspect: ASSETS.aspect || 0.894,
        rarity: 'common', rarityLabel: '普通',
      },
      'pighub-650': {
        id: 'pighub-650', title: '猪搬运', kind: 'live', motion: true, place: 'pen', stars: 1,
        pos: { x: 66, y: 56 }, posAt: 0,
        assetUrl: ASSET_URL, imageUrl: ASSET_URL, url: ASSET_URL,
        sizeRatio: 86.32, aspect: 1.158,
        rarity: 'common', rarityLabel: '普通',
      },
    },
    requests: [],
  };

  /* 与 lib/store.js 的 normaliseState 一样：posAt **不在**落盘白名单里，
   * 所以快照里的 pig 记录永远没有 posAt（这是本轮要证的关键事实之一）。 */
  function snapshot() {
    var pigs = Object.keys(hostState.pigs).map(function (id) {
      var p = hostState.pigs[id];
      return {
        id: p.id, title: p.title, kind: p.kind, motion: p.motion, place: p.place, stars: p.stars,
        pos: p.pos ? { x: p.pos.x, y: p.pos.y } : null,
        assetUrl: p.assetUrl, imageUrl: p.imageUrl, url: p.url,
        sizeRatio: p.sizeRatio, aspect: p.aspect,
        rarity: p.rarity, rarityLabel: p.rarityLabel,
        firstObtainedAt: '2026-11-14T01:00:00.000Z', lastUpgradedAt: '2026-11-14T02:00:00.000Z',
      };
    });
    return {
      ok: true, version: '0.9.59', root: 'C:/Users/test/.PigHub',
      today: { date: '2026-11-14', drawn: true, pigId: 'pighub-1114' },
      pigs: pigs, pets: [], store: [], penCap: 12, penCount: pigs.length,
      pool: pigs.map(function (p) { return { id: p.id, title: p.title, url: p.url, note: '' }; }),
      sort: 'time', prefs: { sort: 'time', starDisplay: 'hover' }, draws: 3,
      assets: { version: '2026.11.14', total: 256, live: 200, dead: 56, available: true },
      catalog: { count: 0, fetchedAt: '', source: '', sources: [], stale: false, error: '' },
      desktopPet: { running: false, stopping: false, supported: false, platform: 'win32' },
      penRect: null,
    };
  }
  /* 令牌按 taste §W.6：**不许**把 pos 这类高频字段放进去。宿主若改位置，客户端靠 10s 整张快照对账。 */
  function revToken() {
    return [
      Object.keys(hostState.pigs).map(function (id) {
        var p = hostState.pigs[id];
        return id + ':' + p.place + ':' + (p.motion ? 1 : 0) + ':' + p.stars;
      }).join('|'),
      'pool:' + Object.keys(ASSETS).length,
    ].join('#');
  }

  window.fetch = function (url, options) {
    var body = options && options.body ? JSON.parse(options.body) : {};
    hostState.requests.push({ action: body.action, at: Date.now(), body: body });
    var reply;
    if (body.action === 'position') {
      var pig = hostState.pigs[body.pigId];
      if (!pig) reply = { ok: false, error: 'unknown_pig' };
      else {
        pig.pos = { x: body.x, y: body.y };
        pig.posAt = body.at || Date.now();
        /* 与 lib/index.js:539 一致：只回 {ok, pos}，**不回快照**（所以客户端手里的快照仍是旧的）。 */
        reply = { ok: true, pos: pig.pos };
      }
    } else if (body.action === 'rev') {
      reply = { ok: true, rev: revToken() };
    } else if (body.action === 'place') {
      var q = hostState.pigs[body.pigId];
      if (q) q.place = body.to;
      reply = snapshot();
    } else {
      reply = snapshot();
    }
    var text = JSON.stringify(reply);
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(text); } });
  };

  /* ---------------------------------------------------- 装载 bundle */
  window.__PIGHUB_LOGS__ = [];
  var regs = [];
  var plugin = window.__PIGHUB_BOOT__(MiniReact);
  plugin.apply({
    effect: function (fn) { return fn(); },
    slots: {
      inject: function (name, factory) { return factory(); },
      register: function (options, component) { regs.push({ options: options, component: component }); return function () {}; },
    },
  });
  var mainRegistration = regs.filter(function (r) { return r.options.name === 'main'; })[0];
  var overlayRegistration = regs.filter(function (r) { return r.options.name === 'shell.overlay'; })[0];

  window.__mount = function () {
    ROOTS = [];
    var mainBox = document.getElementById('root');
    mainBox.textContent = '';
    ROOTS.push({ key: 'root:main', component: mainRegistration.component, container: mainBox, dom: null });
    var overlayBox = document.getElementById('overlay');
    if (!overlayBox) {
      overlayBox = document.createElement('div');
      overlayBox.id = 'overlay';
      overlayBox.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:41';
      document.body.appendChild(overlayBox);
    }
    overlayBox.textContent = '';
    /* 桌宠层与面板同形：它返回 null 时（没有桌宠）也要把 root.dom 记成 null 并跳过挂载。 */
    ROOTS.push({ key: 'root:overlay', component: overlayRegistration.component, container: overlayBox, dom: null });
    flushTree();
    return renderCount;
  };

  /* ---------------------------------------------------- 指针驱动 + 采样 */
  function penRect() { return document.querySelector('.pighub-pen').getBoundingClientRect(); }
  function actorEl(id) { return document.querySelector('[data-pig="' + id + '"]'); }
  function actorImg(id) { var el = actorEl(id); return el ? el.querySelector('img') : null; }
  function centerOf(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  var dragState = null;

  function fire(type, x, y, target) {
    var ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    });
    target.dispatchEvent(ev);
  }

  function sample(id, t0, phase, extra) {
    var el = actorEl(id);
    if (!el) return null;
    var cs = getComputedStyle(el);
    var pen = penRect();
    var r = el.getBoundingClientRect();
    var row = {
      t: Math.round((performance.now() - t0) * 10) / 10,
      phase: phase,
      leftPx: Math.round(parseFloat(cs.left) * 100) / 100,
      topPx: Math.round(parseFloat(cs.top) * 100) / 100,
      leftPct: Math.round((parseFloat(cs.left) / pen.width) * 10000) / 100,
      topPct: Math.round((parseFloat(cs.top) / pen.height) * 10000) / 100,
      declLeft: el.style.left, declTop: el.style.top,
      cx: Math.round((r.left + r.width / 2) * 100) / 100,
      cy: Math.round((r.top + r.height / 2) * 100) / 100,
      opacity: cs.opacity,
      cls: el.className,
      transitionDuration: cs.transitionDuration,
    };
    if (extra) Object.assign(row, extra);
    return row;
  }

  window.__waitActor = async function (id, timeoutMs) {
    var t0 = performance.now();
    while (!actorEl(id) && performance.now() - t0 < (timeoutMs || 6000)) await SLEEP(30);
    await SLEEP(120);
    return !!actorEl(id);
  };

  /* 把某只猪挪回一个已知位置（每次拖放都从同一个起点出发，才好对账）。
   * 走宿主 pos + 快照：客户端会把它当成"外部改了位置"，平滑走过去（约 1 s）。 */
  window.__resetPig = async function (id, x, y) {
    hostState.pigs[id].pos = { x: x, y: y };
    hostState.pigs[id].posAt = Date.now();
    // 用 __test.place 拿一张整张快照（宿主面对 place 的应答里就带着最新 pos）。
    await plugin.__test.place(id, 'pen');
    var t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await SLEEP(40);
      var row = sample(id, t0, 'reset');
      if (row && Math.abs(row.leftPct - x) < 0.2 && Math.abs(row.topPct - y) < 0.2) break;
    }
    await SLEEP(150);
    var el = actorEl(id);
    return el ? centerOf(el) : null;
  };

  /* 开始拖动（按下 + 分步移动）——与 __scenario 共用同一段事件代码。 */
  window.__dragBegin = async function (opts) {
    var id = (opts && opts.id) || PIG_A;
    await window.__waitActor(id, 6000);
    var pen = penRect();
    var start = centerOf(actorEl(id));
    var target = { x: start.x + (opts.dx || 0), y: start.y + (opts.dy || 0) };
    dragState = { id: id, start: start, target: target, pen: pen, t0: performance.now(), series: [] };
    fire('pointerdown', start.x, start.y, actorImg(id));
    for (var i = 1; i <= 6; i += 1) {
      var x = start.x + (target.x - start.x) * i / 6;
      var y = start.y + (target.y - start.y) * i / 6;
      fire('pointermove', x, y, actorImg(id));
      await SLEEP(30);
      dragState.series.push(sample(id, dragState.t0, 'drag'));
    }
    await SLEEP(opts && opts.holdMs != null ? opts.holdMs : 150);
    return {
      id: id,
      pen: { left: pen.left, top: pen.top, width: pen.width, height: pen.height },
      startClient: { x: start.x, y: start.y },
      dropClient: { x: target.x, y: target.y },
      startPct: { x: ((start.x - pen.left) / pen.width) * 100, y: ((start.y - pen.top) / pen.height) * 100 },
      /* 落点按客户端的同一套夹取算：inside 分支写的是 min(90,max(10,x)) / min(88,max(16,y))。 */
      expectPct: {
        x: Math.min(90, Math.max(10, ((target.x - pen.left) / pen.width) * 100)),
        y: Math.min(88, Math.max(16, ((target.y - pen.top) / pen.height) * 100)),
      },
      pointerPct: { x: ((target.x - pen.left) / pen.width) * 100, y: ((target.y - pen.top) / pen.height) * 100 },
      dragSeries: dragState.series,
    };
  };

  /* 松手并连拍 afterMs：这是「松手后位移序列」的唯一来源。 */
  window.__release = async function (opts) {
    var st = dragState;
    var dropAt = performance.now();
    fire('pointerup', st.target.x, st.target.y, actorImg(st.id));
    st.series.push(sample(st.id, st.t0, 'release'));
    var endT = performance.now() + ((opts && opts.afterMs) || 2000);
    while (performance.now() < endT) {
      await SLEEP(50);
      st.series.push(sample(st.id, st.t0, 'post'));
    }
    return { dropAtMs: Math.round(dropAt - st.t0), series: st.series };
  };

  window.__scenario = async function (opts) {
    var info = await window.__dragBegin(opts);
    var after = await window.__release(opts);
    return Object.assign({}, info, after, {
      renderCount: renderCount,
      positionPosts: hostState.requests.filter(function (r) { return r.action === 'position'; }).length,
      requests: hostState.requests.map(function (r) { return r.action + '@' + r.at; }),
      finalPos: hostState.pigs[info.id] ? hostState.pigs[info.id].pos : null,
    });
  };

  /* 读 actor 当前的百分比位置（给驱动侧判断"重置是不是已经落地"）。 */
  window.__actorPct = function (id) {
    var el = actorEl(id);
    if (!el) return null;
    var cs = getComputedStyle(el);
    var pen = penRect();
    return {
      x: Math.round((parseFloat(cs.left) / pen.width) * 10000) / 100,
      y: Math.round((parseFloat(cs.top) / pen.height) * 10000) / 100,
      opacity: Number(cs.opacity),
      duration: cs.transitionDuration,
    };
  };

  window.__hostPos = function (id) {
    var p = hostState.pigs[id || PIG_A];
    return p ? { pos: p.pos, posAt: p.posAt } : null;
  };
  window.__renderCount = function () { return renderCount; };
})();
