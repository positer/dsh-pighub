
/* ============================================================
 * 页内探针装置（遮挡专用）：mini-React + 假宿主 + 遮挡读数
 * 目的：把**发货的** lib/client.js 放进真实浏览器，按场景摆好猪，读真实 DOM 的
 *       z-index / 脚底像素 / elementFromPoint 命中，并允许单只隔离截图（像素判据用）。
 * 假件只有两样（都不是被测代码）：React（宿主提供）与 /pighub 的 HTTP 应答（宿主提供）。
 * ============================================================ */
(function () {
  var SLEEP = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------------------------------------------------- mini React */
  var instances = new Map();
  var cursor = 0, currentPath = null;
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

  function schedule() {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(function () { flushScheduled = false; flushTree(); });
  }
  var effectTimer = null;
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

  /* 属性名映射：React 的 DOM 属性是 camelCase，落到 DOM 上多数要转 kebab，
   * 但 SVG 有一批属性是**驼峰即真名**（viewBox / preserveAspectRatio …）。
   * 不转的话 setAttribute('viewBox') 在 HTML 元素上会被小写成 viewbox，
   * 于是草地的 SVG 没有视口 → 猪圈底下是一片空白（本轮踩到，见 record.md）。 */
  var SVG_CASE = {
    viewBox: 'viewBox', preserveAspectRatio: 'preserveAspectRatio',
    gradientUnits: 'gradientUnits', gradientTransform: 'gradientTransform',
    patternUnits: 'patternUnits', patternContentUnits: 'patternContentUnits',
    clipPathUnits: 'clipPathUnits', maskUnits: 'maskUnits', maskContentUnits: 'maskContentUnits',
    markerWidth: 'markerWidth', markerHeight: 'markerHeight', refX: 'refX', refY: 'refY',
    textLength: 'textLength', spreadMethod: 'spreadMethod', startOffset: 'startOffset',
  };
  function attrName(key) {
    if (Object.prototype.hasOwnProperty.call(SVG_CASE, key)) return SVG_CASE[key];
    if (key.indexOf('--') === 0) return key;
    if (/^(aria|data)-/.test(key)) return key;
    return key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function applyProps(el, props) {
    var prev = el.__props || {};
    var key, val;
    for (key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      if (key === 'key') continue;
      val = props[key];
      if (key === 'ref') { if (val && typeof val === 'object') val.current = el; continue; }
      if (key === 'className') {
        // SVG 元素的 className 是只读的 SVGAnimatedString，只能走 class 属性
        if (el.namespaceURI === SVG_NS) el.setAttribute('class', val === null || val === undefined ? '' : String(val));
        else if (el.className !== val) el.className = val === null || val === undefined ? '' : String(val);
        continue;
      }
      if (key === 'htmlFor') { el.htmlFor = String(val); continue; }
      if (key === 'style') { applyStyle(el, prev.style || {}, val || {}); continue; }
      if (/^on[A-Z]/.test(key)) {
        var evt = key.slice(2).toLowerCase();
        if (el['on' + evt] !== val) el['on' + evt] = val;
        continue;
      }
      if (prev[key] === val) continue;
      if (val === false || val === null || val === undefined) el.removeAttribute(attrName(key));
      else el.setAttribute(attrName(key), String(val));
    }
    for (key in prev) {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) continue;
      if (key in props) continue;
      if (key === 'ref') continue;
      if (key === 'style') { applyStyle(el, prev.style || {}, {}); continue; }
      if (/^on[A-Z]/.test(key)) { el['on' + key.slice(2).toLowerCase()] = null; continue; }
      el.removeAttribute(attrName(key));
    }
    el.__props = props;
  }

  /* SVG 元素必须用 createElementNS 创建：document.createElement('rect') 造出来的是 HTMLUnknownElement，
   * 放进 <svg> 里**不会画**（本轮踩到：猪圈草地整片空白，而围栏图是 <img>/background 所以还在）。 */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = {
    svg: 1, g: 1, rect: 1, circle: 1, ellipse: 1, path: 1, line: 1, polyline: 1, polygon: 1,
    text: 1, tspan: 1, defs: 1, use: 1, clippath: 1, mask: 1, lineargradient: 1, radialgradient: 1,
    stop: 1, pattern: 1, filter: 1, symbol: 1, image: 1,
  };
  function createEl(type) {
    var name = String(type);
    return Object.prototype.hasOwnProperty.call(SVG_TAGS, name.toLowerCase())
      ? document.createElementNS(SVG_NS, name)
      : document.createElement(name);
  }

  function commitNode(v, dom) {
    if (!v) return dom;
    if (v.type === '#text') {
      if (!dom || dom.nodeType !== 3) { var tn = document.createTextNode(v.text); if (dom) dom.replaceWith(tn); return tn; }
      if (dom.nodeValue !== v.text) dom.nodeValue = v.text;
      return dom;
    }
    if (!dom || dom.nodeType !== 1 || dom.tagName.toLowerCase() !== String(v.type).toLowerCase()) {
      var el = createEl(v.type);
      if (dom && dom.parentNode) dom.parentNode.replaceChild(el, dom); else if (dom) dom.replaceWith(el);
      dom = el;
    }
    applyProps(dom, v.props);
    var want = v.children.length;
    for (var i = 0; i < want; i += 1) {
      var childDom = commitNode(v.children[i], dom.childNodes[i] || null);
      if (childDom && childDom.parentNode !== dom) dom.appendChild(childDom);
    }
    while (dom.childNodes.length > want) dom.removeChild(dom.lastChild);
    return dom;
  }

  function runEffects() {
    var list = passEffects; passEffects = [];
    for (var i = 0; i < list.length; i += 1) {
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
    scheduleEffects();
  }

  /* ---------------------------------------------------- 假宿主（/pighub） */
  var ASSETS = window.__PIGHUB_ASSETS__ || {};
  var SCENE = (function () {
    var q = /[?&]scene=([a-z0-9]+)/.exec(location.search);
    return q ? q[1] : 'a';
  })();
  /* 三个场景，坐标是**中心**（与 actor 的 left/top 同一口径，单位 = 猪圈边长的百分比）。
   * 每只猪都有显式的 pos（= 宿主记录的位置），所以挂载即到位、没有过渡动画。 */
  var LAYOUTS = {
    /* A：650 在上、1114 在下 → 1114 的脚底更靠下，必须在前 */
    a: [
      { id: 'pighub-650', x: 50, y: 52 },
      { id: 'pighub-1114', x: 50, y: 62 },
    ],
    /* B：把两只的上下交换 → 遮挡关系必须跟着翻转（不是固定按 id） */
    b: [
      { id: 'pighub-650', x: 50, y: 62 },
      { id: 'pighub-1114', x: 50, y: 52 },
    ],
    /* C：三只叠成一串，从前到后必须等于脚底从低到高 */
    c: [
      { id: 'pighub-650', x: 50, y: 48 },
      { id: 'pighub-1114', x: 50, y: 58 },
      { id: 'standard-pig', x: 50, y: 68 },
    ],
  };
  var TITLES = { 'pighub-650': '猪搬运', 'pighub-1114': '你是小猪', 'standard-pig': '普通猪' };
  var layout = LAYOUTS[SCENE] || LAYOUTS.a;

  var hostState = { pigs: {}, requests: [] };
  layout.forEach(function (item) {
    var asset = ASSETS[item.id] || {};
    hostState.pigs[item.id] = {
      id: item.id, title: TITLES[item.id] || item.id, kind: 'live',
      /* 先按「会动」挂载：静态猪（motion:false）在 usePenActors 里走的是另一条分支，
       * 首次挂载会用网格落点**忽略宿主记录的 pos**（那是运动逻辑，本次不改）。
       * 所以挂载用 motion:true 让位置从 pos 播种，再 __freeze() 翻成静止（静态分支会保留现位置）：
       * 位置全程不变、也没有 breathe/hop 动画 —— 截图与读数才是可比的。 */
      motion: true, place: 'pen', stars: 1,
      pos: { x: item.x, y: item.y }, posAt: 0,
      assetUrl: asset.url, imageUrl: asset.url, url: asset.url,
      sizeRatio: asset.sizeRatio, aspect: asset.aspect,
      rarity: 'common', rarityLabel: '普通',
    };
  });

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
      today: { date: '2026-11-14', drawn: true, pigId: pigs[0].id },
      pigs: pigs, pets: [], store: [], penCap: 12, penCount: pigs.length,
      pool: pigs.map(function (p) { return { id: p.id, title: p.title, url: p.url, note: '' }; }),
      sort: 'time', prefs: { sort: 'time', starDisplay: 'off' }, draws: 3,
      assets: { version: '2026.11.14', total: 256, live: 200, dead: 56, available: true },
      catalog: { count: 0, fetchedAt: '', source: '', sources: [], stale: false, error: '' },
      desktopPet: { running: false, stopping: false, supported: false, platform: 'win32' },
      penRect: null,
    };
  }
  var snapshotText = JSON.stringify(snapshot());
  window.fetch = function (url, options) {
    var body = options && options.body ? JSON.parse(options.body) : {};
    hostState.requests.push({ action: body.action, at: Date.now() });
    var reply;
    if (body.action === 'rev') reply = { ok: true, rev: 'static' };
    else if (body.action === 'position') {
      var pig = hostState.pigs[body.pigId];
      if (pig) { pig.pos = { x: body.x, y: body.y }; reply = { ok: true, pos: pig.pos }; }
      else reply = { ok: false, error: 'unknown_pig' };
    } else reply = JSON.parse(snapshotText);
    var text = JSON.stringify(reply);
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(text); } });
  };

  /* ---------------------------------------------------- 装载 bundle */
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

  /* 静态页里没有宿主的 /pighub/pen/<file> 路由：把围栏图指向本机文件（data URL）。
   * 围栏是这个场景的一部分——猪必须画在**远栏之后、近栏之前**，截图上要能看出来。 */
  function patchFence() {
    var url = window.__PIGHUB_FENCE_URL__;
    if (!url) return 0;
    var shots = document.querySelectorAll('.pighub-fence-shot');
    for (var i = 0; i < shots.length; i += 1) shots[i].style.backgroundImage = 'url("' + url + '")';
    return shots.length;
  }

  window.__mount = function () {
    ROOTS = [];
    var mainBox = document.getElementById('root');
    mainBox.textContent = '';
    ROOTS.push({ key: 'root:main', component: mainRegistration.component, container: mainBox, dom: null });
    flushTree();
    patchFence();
    return renderCount;
  };
  window.__patchFence = patchFence;

  /* ---------------------------------------------------- 读数 API */
  function penRect() { return document.querySelector('.pighub-pen').getBoundingClientRect(); }
  function actorEl(id) { return document.querySelector('.pighub-actor[data-pig="' + id + '"]'); }

  window.__scene = SCENE;
  window.__layout = layout;
  window.__penRect = function () {
    var r = penRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  /* 每只猪：内联 z-index、计算后的 z-index、中心百分比、以及**量出来的**贴图盒子（脚底 = 贴图底边）。 */
  window.__actors = function () {
    var pen = penRect();
    var out = [];
    for (var i = 0; i < layout.length; i += 1) {
      var id = layout[i].id;
      var el = actorEl(id);
      if (!el) { out.push({ id: id, missing: true }); continue; }
      var img = el.querySelector('img');
      var box = el.getBoundingClientRect();
      var ibox = img ? img.getBoundingClientRect() : box;
      var cs = getComputedStyle(el);
      var pig = hostState.pigs[id];
      out.push({
        id: id,
        zInline: el.style.zIndex,
        zComputed: cs.zIndex,
        leftDecl: el.style.left,
        topDecl: el.style.top,
        widthDecl: el.style.width,
        centerPct: {
          x: ((box.left + box.width / 2 - pen.left) / pen.width) * 100,
          y: ((box.top + box.height / 2 - pen.top) / pen.height) * 100,
        },
        box: { left: box.left - pen.left, top: box.top - pen.top, width: box.width, height: box.height },
        imgBox: { left: ibox.left - pen.left, top: ibox.top - pen.top, width: ibox.width, height: ibox.height },
        sizeRatio: pig.sizeRatio,
        aspect: pig.aspect,
        opacity: cs.opacity,
        className: el.className,
        transitionDuration: cs.transitionDuration,
      });
    }
    return out;
  };

  /* 元素盒子的交点（不是 alpha 交集）：用于 elementFromPoint 判「谁在绘制顺序上更靠上」。 */
  function boxOf(id) {
    var el = actorEl(id);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }
  window.__overlaps = function () {
    var pen = penRect();
    var out = [];
    for (var i = 0; i < layout.length; i += 1) {
      for (var j = i + 1; j < layout.length; j += 1) {
        var a = boxOf(layout[i].id), b = boxOf(layout[j].id);
        if (!a || !b) continue;
        var x0 = Math.max(a.left, b.left), x1 = Math.min(a.right, b.right);
        var y0 = Math.max(a.top, b.top), y1 = Math.min(a.bottom, b.bottom);
        if (x1 - x0 < 4 || y1 - y0 < 4) continue;
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        out.push({
          a: layout[i].id, b: layout[j].id,
          rect: { left: x0 - pen.left, top: y0 - pen.top, width: x1 - x0, height: y1 - y0 },
          point: { x: cx - pen.left, y: cy - pen.top },
          hit: window.__hit(cx, cy),
        });
      }
    }
    return out;
  };
  /* elementFromPoint：返回命中的那只猪（null = 没命中猪）。它判的是**绘制顺序**（z 序），
   * 与截图无关，是第二种独立手段。 */
  window.__hit = function (x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var host = el.closest ? el.closest('[data-pig]') : null;
    return host ? host.getAttribute('data-pig') : (el === document.body ? null : 'other:' + el.className);
  };

  /* 只画一只（其余 display:none）：截图对比用。id=null 恢复全部。 */
  window.__isolate = function (id) {
    for (var i = 0; i < layout.length; i += 1) {
      var el = actorEl(layout[i].id);
      if (!el) continue;
      el.style.display = (id && layout[i].id !== id) ? 'none' : '';
    }
    return layout.map(function (item) {
      var el = actorEl(item.id);
      return { id: item.id, display: el ? el.style.display : 'missing' };
    });
  };
  /* 冻结：把「会动」翻成「保持静止」（宿主状态 + 重新取一张快照）。
   * 静态分支会保留当前落点，于是位置从此不再变化，actor 也变成 is-static（CSS 不再挂任何动画）。 */
  window.__freeze = async function () {
    var ids = Object.keys(hostState.pigs);
    for (var i = 0; i < ids.length; i += 1) hostState.pigs[ids[i]].motion = false;
    for (var j = 0; j < ids.length; j += 1) await plugin.__test.place(ids[j], 'pen');
    await SLEEP(260);
    patchFence();
    return ids;
  };
  window.__renderCount = function () { return renderCount; };
})();
