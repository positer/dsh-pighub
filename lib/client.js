/**
 * dsh-pighub —— 浏览器半（Client half）。
 *
 * 契约：这个文件必须是一个 **CJS closure-factory bundle**——脚本执行时只调用
 * window.__ModuleLoader__.load({ id, factory })，所有副作用（含样式注入）都发生在
 * factory 真正被物化时。它不是 ESM，也不能 import：宿主会把页面里冻结的模块表
 * 通过 require 传进来（react / react-dom / @deepseek-ai/cordis …）。
 *
 * 这一半负责三块界面，全部注册在官方增量槽位上（不碰 root / sidebar 这类 single 槽位，
 * 那会把官方声明的子槽位一起带走）：
 *
 *   sidebar.panellist  ← 左栏入口（一只朝右看的猪）
 *   main               ← 面板：左边猪圈，右边像素标题 + 今日猪猪 + 清单
 *   shell.overlay      ← 页面级桌宠层（面板关掉也要在，所以不能挂在面板里）
 *
 * 与生态里其他桌宠插件并存的四条纪律（照 dsh-pet@0.4.8 的实测约定来）：
 *   1. 桌宠层容器 pointer-events: none，只有猪本体接收指针；
 *   2. z-index 取 41（dsh-pet 的根是 40），谁都不遮谁，也不抢模态框的层级；
 *   3. 样式标签带 data-plugin="dsh-pighub"、类名全部 .pighub- 前缀，不写全局选择器；
 *   4. 尊重 prefers-reduced-motion：关掉弹跳与漂移，只保留位置变化。
 */
window.__ModuleLoader__.load({
  id: 'dsh-pighub',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useRef = React.useRef;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useCallback = React.useCallback;

    /* ------------------------------------------------------------------ 样式 */
    const CSS_TAG = 'dsh-pighub/panel';
    /*
     * 样式全部走 DSH 主题令牌（~--dsw-alias-*~），**不判断亮暗**：
     * 深色模式在 shell 里是 ~body[data-ds-dark-theme]~，令牌值由 shell 重定义（见
     * ~@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css~）。
     * 所以只要不写死颜色，主题切换就自动跟随，也不需要维护第二套配色。
     * 猪圈草地与围栏不属于令牌体系，用 ~color-mix~ 与背景令牌混色，同样自动跟随。
     */
    const CSS = [
      '.pighub-panel{position:relative;display:flex;gap:18px;padding:18px;box-sizing:border-box;height:100%;min-height:0;',
      'color:var(--dsw-alias-label-primary,#1f2328);font-family:\'Microsoft YaHei UI\',\'Segoe UI\',\'PingFang SC\',system-ui,sans-serif}',
      '.pighub-panel *{box-sizing:border-box}',
      '.pighub-left{flex:0 0 auto;display:flex;align-items:flex-start}',
      '.pighub-pen{position:relative;width:min(46vmin,400px);aspect-ratio:1/1;border-radius:14px;overflow:hidden;',
      'background:radial-gradient(circle at 30% 25%,',
      'color-mix(in oklab,#cfeaa8 78%,var(--dsw-alias-bg-base,#fff)),',
      'color-mix(in oklab,#9ccc6a 62%,var(--dsw-alias-bg-layer-2,#eef1ea)) 62%,',
      'color-mix(in oklab,#7fbf4e 55%,var(--dsw-alias-bg-layer-2,#eef1ea)));',
      'box-shadow:inset 0 0 0 2px color-mix(in oklab,#6b5433 30%,transparent)}',
      '.pighub-pen:after{content:"";position:absolute;inset:0;pointer-events:none;',
      'background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 6px,transparent 6px 12px)}',
      '.pighub-fence{position:absolute;inset:0;pointer-events:none}',
      '.pighub-fence i{position:absolute;display:block;',
      'background:color-mix(in oklab,#c98a4b 72%,var(--dsw-alias-bg-elevated,#fff));',
      'background-image:repeating-linear-gradient(90deg,',
      'color-mix(in oklab,#7e5024 46%,transparent) 0 5px,transparent 5px 15px),',
      'linear-gradient(180deg,rgba(255,255,255,.30),rgba(60,38,14,.22))}',
      '.pighub-fence .t,.pighub-fence .b{left:0;right:0;height:12px}',
      '.pighub-fence .t{top:0;border-bottom:2px solid color-mix(in oklab,#5a3714 40%,transparent)}',
      '.pighub-fence .b{bottom:0;border-top:2px solid color-mix(in oklab,#5a3714 40%,transparent)}',
      '.pighub-fence .l,.pighub-fence .r{top:0;bottom:0;width:12px;',
      'background-image:repeating-linear-gradient(0deg,',
      'color-mix(in oklab,#7e5024 46%,transparent) 0 5px,transparent 5px 15px),',
      'linear-gradient(90deg,rgba(255,255,255,.30),rgba(60,38,14,.22))}',
      '.pighub-fence .l{left:0;border-right:2px solid color-mix(in oklab,#5a3714 40%,transparent)}',
      '.pighub-fence .r{right:0;border-left:2px solid color-mix(in oklab,#5a3714 40%,transparent)}',
      '.pighub-ground{position:absolute;left:4%;right:4%;bottom:6%;height:34%;border-radius:50%;',
      'background:radial-gradient(ellipse at 50% 50%,rgba(96,68,32,.26),rgba(96,68,32,0) 70%)}',
      '.pighub-actor{position:absolute;transform:translate(-50%,-50%);width:15%;',
      'transition:left 1.1s ease-in-out,top 1.1s ease-in-out;will-change:left,top}',
      '.pighub-actor img{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;',
      'touch-action:none;cursor:grab;filter:drop-shadow(0 2px 2px rgba(0,0,0,.32))}',
      '.pighub-actor.is-walk img{animation:pighub-hop .62s ease-in-out infinite}',
      '.pighub-actor.is-idle img{animation:pighub-breathe 2.4s ease-in-out infinite}',
      '.pighub-actor.is-static img{animation:none}',
      '.pighub-actor.is-squish img{animation:pighub-squish .58s cubic-bezier(.34,1.56,.64,1) !important}',
      '@keyframes pighub-squish{0%{transform:scale(1,1)}22%{transform:scale(1.18,.8) translateY(6%)}58%{transform:scale(.93,1.09) translateY(-4%)}100%{transform:scale(1,1)}}',
      '.pighub-starbadge{position:absolute;left:50%;bottom:calc(100% - 2px);transform:translate(-50%,-2px);',
      'background:var(--dsw-alias-bg-layer-3,#f7f7f7);color:var(--dsw-alias-label-primary,#1f2328);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
      'font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;',
      'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .16s ease;letter-spacing:1px;z-index:3}',
      '.pighub-starbadge.on{opacity:1}',
      '.pighub-settings{position:absolute;right:14px;top:14px;z-index:5;display:flex;gap:6px;align-items:center}',
      '.pighub-iconbtn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;',
      'border:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.28));',
      'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));color:inherit;cursor:pointer}',
      '.pighub-iconbtn:hover{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.16))}',
      '.pighub-pop{position:absolute;right:0;top:38px;width:264px;padding:12px;border-radius:12px;z-index:6;',
      'background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.24));',
      'box-shadow:0 10px 30px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:10px}',
      '.pighub-pop h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#5a5a5a)}',
      '.pighub-seg{display:flex;gap:4px;flex-wrap:wrap}',
      '.pighub-seg button{flex:1 1 auto;border:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.3));background:transparent;',
      'color:inherit;border-radius:8px;padding:6px 4px;font-size:12px;cursor:pointer}',
      '.pighub-seg button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(226,84,58,.14));',
      'border-color:var(--dsw-alias-brand-primary,#e2543a);color:var(--dsw-alias-brand-primary,#c8402a);font-weight:600}',
      '.pighub-pop .row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;',
      'color:var(--dsw-alias-label-secondary,#5a5a5a)}',
      '.pighub-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary,#c8402a);font-size:12px;',
      'cursor:pointer;padding:0;text-decoration:underline}',
      '.pighub-path{font-family:ui-monospace,Consolas,monospace;font-size:10px;word-break:break-all;',
      'color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
      '.pighub-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      'color:var(--dsw-alias-label-secondary,#4b5a3c);font-size:13px;pointer-events:none;text-align:center;padding:24px}',
      '.pighub-right{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:14px}',
      '.pighub-head{display:flex;flex-direction:column;gap:10px;align-items:flex-start}',
      '.pighub-title{display:block;height:46px;color:var(--dsw-alias-brand-primary,#e2543a)}',
      '.pighub-title svg{height:46px;width:auto;display:block;shape-rendering:crispEdges}',
      '.pighub-draw{border:0;border-radius:10px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer;',
      'background:var(--dsw-alias-button-primary-fill,#e2543a);color:var(--dsw-alias-label-primary-inverted,#fff);',
      'box-shadow:0 2px 0 color-mix(in oklab,var(--dsw-alias-button-primary-fill,#e2543a) 70%,#000);',
      'transition:transform .12s ease,box-shadow .12s ease}',
      '.pighub-draw:active{transform:translateY(1px);box-shadow:0 1px 0 color-mix(in oklab,var(--dsw-alias-button-primary-fill,#e2543a) 70%,#000)}',
      '.pighub-draw:disabled{background:var(--dsw-alias-bg-mask-2,#d9dcd4);color:var(--dsw-alias-label-tertiary,#6b7466);',
      'box-shadow:none;cursor:default}',
      '.pighub-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#5a5a5a);line-height:1.5}',
      '.pighub-sorts{display:flex;gap:6px;flex-wrap:wrap}',
      '.pighub-sort{border:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.32));background:transparent;color:inherit;',
      'border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer}',
      '.pighub-sort[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(226,84,58,.12));',
      'border-color:var(--dsw-alias-brand-primary,#e2543a);color:var(--dsw-alias-brand-primary,#c8402a)}',
      '.pighub-list{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding-right:4px}',
      '.pighub-row{display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));',
      // 亮色主题里 layer-1 与底色同为白，只靠背景分不出卡片；补一圈极淡描边，两种主题都成立。
      'border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}',
      '.pighub-row:hover{border-color:var(--dsw-alias-border-l2,rgba(226,84,58,.35))}',
      '.pighub-row img{width:44px;height:44px;object-fit:cover;border-radius:8px;flex:0 0 auto;',
      'background:var(--dsw-alias-bg-mask-2,rgba(127,127,127,.12))}',
      '.pighub-row-main{min-width:0;flex:1 1 auto}',
      '.pighub-row-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pighub-row-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#5a5a5a);margin-top:2px;line-height:1.45;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pighub-stars{flex:0 0 auto;color:var(--dsw-static-amber-500,#f0a92c);font-size:12px;letter-spacing:1px}',
      '.pighub-tag{flex:0 0 auto;font-size:11px;padding:2px 7px;border-radius:999px;',
      'background:var(--dsw-alias-bg-mask-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#5a5a5a)}',
      '.pighub-pets{position:fixed;inset:0;z-index:41;pointer-events:none;overflow:hidden}',
      '.pighub-reveal{position:fixed;left:0;top:0;z-index:60;pointer-events:none;will-change:transform,opacity}',
      '.pighub-reveal img{display:block;width:100%;height:100%;filter:drop-shadow(0 8px 14px rgba(0,0,0,.32))}',
      '.pighub-reveal.is-pop img{animation:pighub-pop .5s cubic-bezier(.2,1.7,.42,1) both}',
      '@keyframes pighub-pop{0%{transform:scale(.15) rotate(-25deg);opacity:0}55%{transform:scale(1.22) rotate(8deg);opacity:1}100%{transform:scale(1) rotate(0)}}',
      '.pighub-reveal.is-fly{transition:transform .64s cubic-bezier(.5,.05,.3,1),opacity .2s .5s}',
      '.pighub-spark{position:fixed;left:0;top:0;width:9px;height:9px;border-radius:50%;z-index:59;pointer-events:none;',
      'background:radial-gradient(circle,var(--dsw-static-amber-100,#fff3c4) 0%,var(--dsw-static-amber-400,#ffd479) 60%,transparent 70%);',
      'animation:pighub-spark .72s ease-out both}',
      '@keyframes pighub-spark{0%{transform:translate3d(var(--sx),var(--sy),0) scale(.4);opacity:0}25%{opacity:1}100%{transform:translate3d(var(--ex),var(--ey),0) scale(.15);opacity:0}}',
      '.pighub-pet{position:absolute;width:72px;height:72px;pointer-events:auto;cursor:grab;',
      'transition:left 1.05s linear,top 1.05s linear;touch-action:none}',
      '.pighub-pet img{display:block;width:100%;height:100%;object-fit:contain;user-select:none;',
      '-webkit-user-drag:none;pointer-events:auto;filter:drop-shadow(0 3px 3px rgba(0,0,0,.3))}',
      '.pighub-pet.is-idle img{animation:pighub-pet-breathe 2.6s ease-in-out infinite}',
      '@keyframes pighub-pet-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}',
      '.pighub-pet.is-drag{transition:none;cursor:grabbing}',
      '.pighub-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:62;pointer-events:none;',
      'background:var(--dsw-alias-toast-bg,#202020);color:var(--dsw-alias-label-primary-foreground,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));',
      'padding:8px 14px;border-radius:999px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.24)}',
      '@media (prefers-reduced-motion: reduce){.pighub-actor,.pighub-pet,.pighub-zz,.pighub-reveal img{animation:none !important;transition:none !important}}',
    ].join('');

    function injectCss() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-pighub';
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const REDUCED = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    /* -------------------------------------------------- 侧边栏 icon：朝右的猪 */
    /**
     * 24x24 描边图标：椭圆身 + 右侧猪鼻 + 上耳 + 一只眼 + 两条腿 + 左侧卷尾。
     * 用 currentColor 描边，因此跟随侧栏的选中/悬停配色，与其他入口同样粗细、同样尺寸
     * （Memory Lab 的图标也是 props.size 默认 16，本图标对齐同一约定）。
     */
    function PigHubIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false, style: { display: 'block' },
      },
        h('ellipse', { cx: 11.5, cy: 12.6, rx: 7.6, ry: 5.2 }),
        h('path', { d: 'M18.4 10.4 h1.9 a2 2 0 0 1 0 4 h-1.9' }),
        h('path', { d: 'M8.6 8.1 L10.1 5.3 L12.2 8' }),
        h('path', { d: 'M7.6 17.6 v2.2' }),
        h('path', { d: 'M14.2 17.6 v2.2' }),
        h('path', { d: 'M4.1 11.2 c-1.5 -.3 -1.9 -1.7 -.8 -2.3 c.8 -.4 1.4 .2 1.1 .9' }),
        h('circle', { cx: 14.6, cy: 11.2, r: 0.75, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 19.5, cy: 11.7, r: 0.42, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 19.5, cy: 13.5, r: 0.42, fill: 'currentColor', stroke: 'none' }),
      );
    }

    /* ------------------------------------------------ 像素标题：PigHub 字形表 */
    /**
     * 5x7 位图字模。每一行 5 个字符，'#' 点亮。
     * 手写而非用字体：字体在任何机器上都渲染成矢量，「像素风」就没了；位图在任何
     * DPI 下都是同一块方格，而且不需要下载字体文件（也就不会因此多一个网络依赖）。
     */
    const GLYPHS = {
      P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
      i: ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'],
      g: ['.....', '.....', '.####', '#...#', '.####', '....#', '.###.'],
      H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
      u: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.###.'],
      b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
    };

    /**
     * 把 'PigHub' 画成 SVG 方块。字距 1 格，总共 6*5 + 5 = 35 格宽、7 格高。
     * 阴影是一份偏移 0.55 格的同样方块，颜色更深——用图形叠出「硬阴影」，
     * 而不是 text-shadow（那是给文字用的，对 SVG 方块无效）。
     */
    function PixelTitle() {
      const word = 'PigHub';
      const cells = [];
      word.split('').forEach((ch, gi) => {
        const glyph = GLYPHS[ch] || GLYPHS.unknown;
        for (let r = 0; r < glyph.length; r += 1) {
          for (let c = 0; c < glyph[r].length; c += 1) {
            if (glyph[r][c] !== '#') continue;
            cells.push([gi * 6 + c, r]);
          }
        }
      });
      const width = word.length * 6 - 1;
      const rects = cells.map(([x, y], i) => h('rect', { key: 'c' + i, x, y, width: 1, height: 1 }));
      const shadow = cells.map(([x, y], i) => h('rect', { key: 's' + i, x: x + 0.55, y: y + 0.55, width: 1, height: 1 }));
      return h('span', { className: 'pighub-title', role: 'img', 'aria-label': 'PigHub' },
        h('svg', { viewBox: '0 0 ' + width + ' 7', preserveAspectRatio: 'xMinYMin meet' },
          h('g', { fill: 'rgba(120,40,20,.35)' }, shadow),
          h('g', { fill: 'currentColor' }, rects),
        ),
      );
    }

    /* ---------------------------------------------------------------- 数据层 */
    /*
     * 一个 factory 级的单例 store：面板与桌宠层是两个槽位里的两个组件，但它们必须看到
     * 同一份「我有哪些猪」，所以状态不放在任何一个组件里。订阅式而非 Context，是因为
     * 桌宠层挂在 shell.overlay 上，与 main 里的面板不是同一棵子树，套 Provider 够不着。
     */
    const ROUTE = '/pighub';

    function createStore() {
      let state = { phase: 'idle', data: null, error: '', drag: null, penRect: null, toast: '' };
      const listeners = new Set();
      let toastTimer = null;
      const get = () => state;
      const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* 单个订阅者出错不拖垮其他 */ } } };
      const set = (patch) => {
        state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch);
        emit();
      };
      const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
      const toast = (text) => {
        set({ toast: text });
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: '' }), 2600);
      };

      async function request(body) {
        const response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        let json;
        try { json = JSON.parse(text); } catch { json = { ok: false, error: 'bad_response' }; }
        if (!response.ok && !json.error) json.error = 'http_' + response.status;
        return json;
      }

      function apply(payload) {
        const ok = payload && payload.ok !== false;
        set({
          phase: ok ? 'ready' : 'error',
          data: payload && payload.pigs ? payload : state.data,
          error: ok ? '' : String((payload && (payload.error || (payload.catalog && payload.catalog.error))) || 'error'),
        });
      }

      async function load() {
        set({ phase: state.data ? state.phase : 'loading' });
        try { apply(await request({ action: 'state' })); }
        catch (error) { set({ phase: 'error', error: String((error && error.message) || error) }); }
      }

      async function draw() {
        try {
          const payload = await request({ action: 'draw' });
          apply(payload);
          if (payload.draw && payload.draw.ok) {
            const pig = (payload.pigs || []).find((p) => p.id === payload.draw.pigId);
            toast(payload.draw.upgraded
              ? '重复的猪猪！' + (pig ? '「' + pig.title + '」' : '') + ' 升到 ' + payload.draw.stars + ' 星'
              : '抽到新猪猪：' + (pig ? '「' + pig.title + '」' : ''));
          } else if (payload.draw) {
            toast(payload.draw.error === 'already_drawn' ? '今天已经抽过了，明天再来' : '抽不到：' + payload.draw.error);
          }
          return payload;
        } catch (error) { set({ error: String((error && error.message) || error) }); return null; }
      }

      async function sort(next) {
        try { apply(await request({ action: 'sort', sort: next })); }
        catch (error) { set({ error: String((error && error.message) || error) }); }
      }

      async function setPet(pigId, pet) {
        try { apply(await request({ action: 'pet', pigId, pet })); }
        catch (error) { set({ error: String((error && error.message) || error) }); }
      }

      async function updatePrefs(patch) {
        try { apply(await request(Object.assign({ action: 'prefs' }, patch))); }
        catch (error) { set({ error: String((error && error.message) || error) }); }
      }

      async function refreshCatalog() {
        try {
          set({ phase: state.data ? state.phase : 'loading' });
          apply(await request({ action: 'refresh' }));
          toast('素材已重新同步');
        } catch (error) {
          set({ error: String((error && error.message) || error) });
          toast('同步失败：' + ((error && error.message) || error));
        }
      }

      return {
        get, set, subscribe, toast, load, draw, sort, setPet, updatePrefs, refreshCatalog,
        beginDrag: (drag) => set({ drag }),
        moveDrag: (x, y, drag) => set({ drag: Object.assign({}, drag, { x, y }) }),
        endDrag: () => set({ drag: null }),
        setPenRect: (rect) => set({ penRect: rect }),
      };
    }

    const STORE = createStore();

    /* ------------------------------------------------------- 素材：去白底透明 */
    /*
     * PigHub 的图多是**白底 JPG 梗图**。直接把白底贴在猪圈里，猪就像一张张卡片；
     * 所以这里把「与边框连通的白」抠成透明，只留主体。
     *
     * 为什么必须在浏览器里做：Node 侧没有解码器（本项目零依赖），而浏览器本来就要解码；
     * 为什么必须走自己的 /pighub/image 代理：上游图片**不带 CORS 头**，直接读像素会把
     * canvas 标成 tainted，getImageData 直接抛错。同源代理后 canvas 是干净的。
     *
     * 抠图规则刻意选「从四边向内漫水填充」，而不是「全图去白」：梗图内部常有白色对话框，
     * 全图去白会把它们也打穿。四边连通的白才是背景。
     */
    const IMAGE_CACHE = new Map();    // 原图 URL -> 处理后的 objectURL
    const IMAGE_PENDING = new Map();  // 原图 URL -> 进行中的 Promise（并发去重）
    const IMAGE_FAILED = new Set();   // 处理失败过：直接退回原图，不反复重试
    const WHITE_MIN = 232;

    function proxyUrl(rawUrl) {
      return '/pighub/image?src=' + encodeURIComponent(rawUrl);
    }

    function toBlobUrl(bitmap, cut) {
      /* 定制切分：每张图有自己的归一化裁切框 [x,y,w,h]，先按它裁，再按自己的阈值去白。
       * 参数来自冻结库（assets/manifest.json → pig.cut），所以同一张源图在任何机器上
       * 都切出同一个结果——「逐图判定」因此是可复现的，而不是凭手感。 */
      const trim = cut && Array.isArray(cut.trim) && cut.trim.length === 4 ? cut.trim : [0, 0, 1, 1];
      const whiteMin = cut && Number.isFinite(cut.white) ? cut.white : WHITE_MIN;
      const sx = Math.max(0, Math.round(bitmap.width * trim[0]));
      const sy = Math.max(0, Math.round(bitmap.height * trim[1]));
      const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(bitmap.width * trim[2])));
      const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(bitmap.height * trim[3])));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const surface = canvas.getContext('2d', { willReadFrequently: true });
      if (!surface) return Promise.reject(new Error('no_canvas_2d'));
      surface.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      const frame = surface.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      const width = canvas.width;
      const height = canvas.height;
      const seen = new Uint8Array(width * height);
      const queue = [];
      const near = (index) => data[index * 4] >= whiteMin && data[index * 4 + 1] >= whiteMin && data[index * 4 + 2] >= whiteMin;
      const push = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const index = y * width + x;
        if (seen[index]) return;
        if (!near(index)) return;
        seen[index] = 1;
        queue.push(index);
      };
      for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
      for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
      while (queue.length) {
        const index = queue.pop();
        const x = index % width;
        const y = (index - x) / width;
        data[index * 4 + 3] = 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
      }
      /*
       * 逐图判定里 vector=true 的图，走描摹而不是位图：放多大都不糊。
       *
       * 描摹前先缩到最长边 ≤ 220px：marching squares 是 O(像素数 × 颜色数)，
       * 直接拿 600×600 的原图描会卡住主线程好几秒；而矢量结果本来就不依赖源分辨率，
       * 220px 已经足够还原平涂卡通的轮廓。viewBox 用缩小后的尺寸，缩放时仍是矢量。
       */
      // 先把去白结果写回画布：下面描摹是**从画布**缩放取样，不写回就会把白底也描进去。
      surface.putImageData(frame, 0, 0);
      if (cut && cut.vector) {
        const TRACE_MAX_EDGE = 220;
        const scale = Math.min(1, TRACE_MAX_EDGE / Math.max(width, height));
        const smallW = Math.max(1, Math.round(width * scale));
        const smallH = Math.max(1, Math.round(height * scale));
        const small = document.createElement('canvas');
        small.width = smallW;
        small.height = smallH;
        const smallSurface = small.getContext('2d', { willReadFrequently: true });
        if (smallSurface) {
          smallSurface.drawImage(canvas, 0, 0, smallW, smallH);
          const svg = vectorise(smallSurface.getImageData(0, 0, smallW, smallH));
          if (svg) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        }
      }
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('to_blob_failed')); return; }
          resolve(URL.createObjectURL(blob));
        }, 'image/png');
      });
    }

    async function makeTransparent(rawUrl, cut) {
      const response = await fetch(proxyUrl(rawUrl));
      if (!response.ok) throw new Error('image_http_' + response.status);
      const blob = await response.blob();
      if (typeof createImageBitmap !== 'function') throw new Error('no_image_bitmap');
      const bitmap = await createImageBitmap(blob);
      try { return await toBlobUrl(bitmap, cut); }
      finally { if (bitmap && typeof bitmap.close === 'function') bitmap.close(); }
    }

    /**
     * 一批猪的「已抠底」图片地址（键是猪 id）。
     *
     * 为什么是「一批」而不是一只一个 hook：一只一个组件就得为每只猪开一个 Hook 槽，
     * 而猪的数量是运行期才知道的；放在面板这一层按列表统一处理，槽位数量就恒定。
     * 首帧先给原图（不等网络），抠完再换——列表不会有一秒空白，失败也只是「没抠干净」。
     */
    function usePigImages(pigs) {
      const [resolved, setResolved] = useState({});
      const signature = pigs.map((pig) => pig.id + ':' + (pig.imageUrl || '') + ':' + JSON.stringify(pig.cut || null)).join('|');
      useEffect(() => {
        let alive = true;
        const first = {};
        for (const pig of pigs) {
          const raw = pig.imageUrl;
          if (!raw) continue;
          // 缓存键必须带上切分参数：同一张源图用不同裁切框切出来是不同的产物。
          const key = raw + '#' + JSON.stringify(pig.cut || null);
          if (IMAGE_CACHE.has(key)) { first[pig.id] = IMAGE_CACHE.get(key); continue; }
          first[pig.id] = raw;
          if (IMAGE_FAILED.has(key)) continue;
          if (!IMAGE_PENDING.has(key)) {
            IMAGE_PENDING.set(key, makeTransparent(raw, pig.cut).catch(() => {
              IMAGE_FAILED.add(key);
              return raw;
            }));
          }
          IMAGE_PENDING.get(key).then((next) => {
            IMAGE_PENDING.delete(key);
            if (next && next !== raw) IMAGE_CACHE.set(key, next);
            if (alive) setResolved((prev) => Object.assign({}, prev, { [pig.id]: next || raw }));
          });
        }
        if (alive) setResolved((prev) => Object.assign({}, prev, first));
        return () => { alive = false; };
      }, [signature]);
      return resolved;
    }

    /* @trace:begin —— 这一段被 test/trace.test.mjs 原样取出，在 Node 里跑单元测试。
     * 之所以从 bundle 里取而不是重复实现：client.js 是闭包工厂，无法 import；
     * 复制一份代码去测试，测的就不是发布出去的那份了。 */
    /* ------------------------------------------------- 矢量图化（描摹成 SVG） */
    /*
     * 为什么做：位图放大就糊。猪猪图多是**平涂卡通**，非常适合描摹成少量色块 + 路径；
     * 描成 SVG 之后由浏览器按显示尺寸重新栅格化，放多大都不糊。
     *
     * 做法（不依赖任何库，全在浏览器里）：
     *   1. 量化：把已抠底的位图压到最多 6 个色块（透明像素不参与）；
     *   2. 等值线：对每个色块用 marching squares 抽边界环（内外环一视同仁，靠 evenodd 填）；
     *   3. 简化：Douglas–Peucker，把像素锯齿压成折线；
     *   4. 输出 <svg viewBox=...><path fill-rule=evenodd/></svg>，转 data URL。
     *
     * 注意：这是「平涂描摹」，不是照片级矢量化。场景类整图（照片/海报）描出来会很脏，
     * 所以是否描摹跟着**逐图判定**走（judgements.json 的 vector 字段），而不是一刀切。
     */
    const TRACE_MAX_COLORS = 6;
    const TRACE_EPSILON = 1.15;

    /** 把 RGBA 压成「色块索引图」：透明 = -1，其余按 5 bit 桶聚类后合并到最常见的 K 种。 */
    function quantize(frame) {
      const { width, height, data } = frame;
      const counts = new Map();
      const buckets = new Int16Array(width * height).fill(-1);
      for (let index = 0; index < width * height; index += 1) {
        const alpha = data[index * 4 + 3];
        if (alpha < 24) continue;
        const r = data[index * 4], g = data[index * 4 + 1], b = data[index * 4 + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        counts.set(key, (counts.get(key) || 0) + 1);
        buckets[index] = key;
      }
      const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TRACE_MAX_COLORS);
      const indexOf = new Map(palette.map(([key], index) => [key, index]));
      const labels = new Int16Array(width * height).fill(-1);
      for (let index = 0; index < width * height; index += 1) {
        const key = buckets[index];
        if (key < 0) continue;
        // 桶不在前 K 名里，就归到最近的调色板颜色（按 5 bit 距离）。
        let label = indexOf.get(key);
        if (label === undefined) {
          let best = 0, bestDistance = 1e9;
          palette.forEach(([candidate], position) => {
            const dr = ((candidate >> 10) & 31) - ((key >> 10) & 31);
            const dg = ((candidate >> 5) & 31) - ((key >> 5) & 31);
            const db = (candidate & 31) - (key & 31);
            const distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance) { bestDistance = distance; best = position; }
          });
          label = best;
        }
        labels[index] = label;
      }
      const colors = palette.map(([key]) => {
        const r = ((key >> 10) & 31) * 8 + 4;
        const g = ((key >> 5) & 31) * 8 + 4;
        const b = (key & 31) * 8 + 4;
        return 'rgb(' + r + ',' + g + ',' + b + ')';
      });
      /*
       * 合并「小而近」的色块。
       *
       * 源图是带渐变的插画，量化后会把同一块受光面拆成一圈圈相近的色（放大就是色带）。
       * 规则：占比 < 3% **且** 与某个更大色块的距离很近（5bit 空间里 < 10）→ 并进去。
       * 反例保护：眼睛/鼻孔这类小但颜色差别大的色块（距离远）**不会**被合并。
       */
      const totals = new Array(colors.length).fill(0);
      for (const label of labels) if (label >= 0) totals[label] += 1;
      const totalPixels = totals.reduce((sum, value) => sum + value, 0) || 1;
      const remap = new Array(colors.length).fill(-1);
      for (let small = 0; small < colors.length; small += 1) {
        if (totals[small] / totalPixels >= 0.03) continue;
        const [sr, sg, sb] = colors[small].match(/\d+/g).map(Number);
        for (let big = 0; big < colors.length; big += 1) {
          if (big === small || remap[big] >= 0) continue;
          if (totals[big] / totalPixels < 0.03) continue;
          const [br, bg, bb] = colors[big].match(/\d+/g).map(Number);
          const distance = Math.abs(br - sr) + Math.abs(bg - sg) + Math.abs(bb - sb);
          if (distance <= 26) { remap[small] = big; break; }
        }
      }
      if (remap.some((value) => value >= 0)) {
        for (let index = 0; index < labels.length; index += 1) {
          const label = labels[index];
          if (label >= 0 && remap[label] >= 0) labels[index] = remap[label];
        }
      }
      return { labels: smoothLabels(labels, width, height), colors, width, height };
    }

    /**
     * marching squares：返回某个色块的所有闭合边界环（像素坐标）。
     *
     * 几何约定（容易写错的点）：格点取在**像素中心**，所以一个 cell 的四个角是
     * (x,y)(x+1,y)(x,y+1)(x+1,y+1)，四条边的中点分别是 top(x+.5,y) right(x+1,y+.5)
     * bottom(x+.5,y+1) left(x,y+.5)。边界外一律按「不属于该色块」处理。
     * 内外环不区分方向：最终统一用 fill-rule=evenodd 填，洞自然被挖掉。
     */
    /**
     * 3×3 众数平滑，跑两遍。
     *
     * 为什么需要：原图是 JPG，平涂区域里仍有轻微渐变，量化后会出现「同色系的细条纹」，
     * 描出来就是一层层色带（放大 3 倍肉眼可见）。取邻域众数能把这类 1px 条纹吃掉，
     * 而真正的轮廓（宽度远大于 1px）不受影响。
     */
    function smoothLabels(labels, width, height) {
      let current = labels;
      for (let pass = 0; pass < 2; pass += 1) {
        const next = Int16Array.from(current);
        const tally = new Map();
        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            const index = y * width + x;
            const self = current[index];
            if (self < 0) continue;
            tally.clear();
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                const value = current[(y + dy) * width + (x + dx)];
                if (value < 0) continue;
                tally.set(value, (tally.get(value) || 0) + 1);
              }
            }
            let best = self, bestCount = tally.get(self) || 0;
            for (const [value, count] of tally) {
              if (count > bestCount) { best = value; bestCount = count; }
            }
            next[index] = best;
          }
        }
        current = next;
      }
      return current;
    }

    function contours(labels, width, height, target) {
      const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : (labels[y * width + x] === target ? 1 : 0));
      /*
       * 边用**无向**方式存：每个 cell 给出的有向线段方向并不保证首尾相接，
       * 按方向链会在中途断开（实测会得到一堆「29 个点的开链、面积算不对」）。
       * 这里存边表 + 顶点邻接，串环时两边都走，闭合即止。
       */
      const edges = [];        // { a: 'x,y', b: 'x,y', used: false }
      const adjacency = new Map();
      const push = (x1, y1, x2, y2) => {
        const index = edges.length;
        edges.push({ a: x1 + ',' + y1, b: x2 + ',' + y2, used: false });
        for (const key of [x1 + ',' + y1, x2 + ',' + y2]) {
          if (!adjacency.has(key)) adjacency.set(key, []);
          adjacency.get(key).push(index);
        }
      };
      for (let y = -1; y < height; y += 1) {
        for (let x = -1; x < width; x += 1) {
          const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
          const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
          if (code === 0 || code === 15) continue;
          const top = [x + 0.5, y], right = [x + 1, y + 0.5];
          const bottom = [x + 0.5, y + 1], left = [x, y + 0.5];
          const seg = (a, b) => push(a[0], a[1], b[0], b[1]);
          if (code === 1) seg(left, bottom);          // 只有左下
          else if (code === 2) seg(bottom, right);    // 只有右下
          else if (code === 3) seg(left, right);      // 下侧
          else if (code === 4) seg(top, right);       // 只有右上
          else if (code === 5) { seg(left, bottom); seg(top, right); }   // 鞍点：按两块斜对处理
          else if (code === 6) seg(top, bottom);      // 右侧
          else if (code === 7) seg(left, top);        // 缺左上
          else if (code === 8) seg(left, top);        // 只有左上
          else if (code === 9) seg(top, bottom);      // 左侧
          else if (code === 10) { seg(left, top); seg(bottom, right); }  // 鞍点（另一种斜对）
          else if (code === 11) seg(right, top);      // 缺右上
          else if (code === 12) seg(left, right);     // 上侧
          else if (code === 13) seg(bottom, right);   // 缺右下
          else if (code === 14) seg(left, bottom);    // 缺左下
        }
      }
      const loops = [];
      for (let index = 0; index < edges.length; index += 1) {
        if (edges[index].used) continue;
        const first = edges[index];
        edges[index].used = true;
        const startKey = first.a;
        const loop = [startKey.split(',').map(Number)];
        let current = first.b;
        for (let step = 0; step < 100000; step += 1) {
          if (current === startKey) break;
          loop.push(current.split(',').map(Number));
          const candidates = adjacency.get(current) || [];
          let nextEdge = -1;
          for (const candidate of candidates) {
            if (!edges[candidate].used) { nextEdge = candidate; break; }
          }
          if (nextEdge < 0) break;
          const edge = edges[nextEdge];
          edge.used = true;
          current = edge.a === current ? edge.b : edge.a;
        }
        if (loop.length > 3) loops.push(loop);
      }
      return loops;
    }

    /** Douglas–Peucker 简化（闭合环按开折线处理，端点固定）。 */
    function simplify(points, epsilon) {
      if (points.length < 4) return points;
      const distance = (p, a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const length = Math.hypot(dx, dy);
        if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
      };
      const keep = new Uint8Array(points.length);
      keep[0] = 1; keep[points.length - 1] = 1;
      const stack = [[0, points.length - 1]];
      while (stack.length) {
        const [first, last] = stack.pop();
        let farthest = -1, record = 0;
        for (let index = first + 1; index < last; index += 1) {
          const d = distance(points[index], points[first], points[last]);
          if (d > record) { record = d; farthest = index; }
        }
        if (farthest > 0 && record > epsilon) {
          keep[farthest] = 1;
          stack.push([first, farthest], [farthest, last]);
        }
      }
      return points.filter((_, index) => keep[index]);
    }

    /** 一帧 RGBA → SVG 字符串（没有可描内容时返回 null）。 */
    function vectorise(frame, epsilon) {
      const { labels, colors, width, height } = quantize(frame);
      const paths = [];
      colors.forEach((color, index) => {
        const loops = contours(labels, width, height, index);
        let area = 0;
        loops.forEach((loop) => {
          for (let i = 0; i < loop.length - 1; i += 1) {
            area += loop[i][0] * loop[i + 1][1] - loop[i + 1][0] * loop[i][1];
          }
        });
        if (Math.abs(area) / 2 < 3) return;   // 噪点色块丢弃（面积按 shoelace/2 计）
        const d = loops.map((loop) => {
          const points = simplify(loop, epsilon || TRACE_EPSILON);
          if (points.length < 3) return '';
          const head = 'M' + points[0][0].toFixed(1) + ' ' + points[0][1].toFixed(1);
          const body = points.slice(1).map((point) => 'L' + point[0].toFixed(1) + ' ' + point[1].toFixed(1)).join('');
          return head + body + 'Z';
        }).filter(Boolean).join('');
        if (d) paths.push({ color, d, area: Math.abs(area) / 2 });
      });
      paths.sort((a, b) => b.area - a.area);
      if (paths.length === 0) return null;
      const body = paths.map((path) => '<path fill="' + path.color + '" fill-rule="evenodd" d="' + path.d + '"/>').join('');
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" shape-rendering="geometricPrecision">' + body + '</svg>';
    }
    /* @trace:end */

    /* --------------------------------------------------------- 星级小胶囊 */
    /**
     * 星级显示三档（设置项，存在 prefs.starDisplay）：
     *   off     —— 完全不渲染；
     *   hover   —— 鼠标划过那只猪显示，5 秒后自动消失；
     *   always  —— 常驻在猪的上方。
     * 组件只负责「这一帧亮不亮」，计时留给调用方（它知道谁被划过）。
     */
    function StarBadge(props) {
      if (props.mode === 'off') return null;
      const visible = props.mode === 'always' || props.visible === true;
      return h('span', { className: 'pighub-starbadge' + (visible ? ' on' : ''), 'aria-hidden': visible ? 'false' : 'true' },
        starText(props.stars));
    }
    /* --------------------------------------------------------------- 小工具 */
    const STAR_MAX = 8;
    function starText(stars) {
      const n = Math.max(1, Math.floor(Number(stars) || 1));
      if (n <= STAR_MAX) return new Array(n + 1).join('\u2605');
      return new Array(STAR_MAX + 1).join('\u2605') + ' x' + n;
    }
    function shortTime(iso) {
      if (!iso) return '—';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '—';
      const pad = (n) => String(n).padStart(2, '0');
      return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes());
    }
    function pigImage(pig, src) {
      return h('img', {
        src: src || pig.imageUrl,
        alt: pig.title || ('猪猪 ' + pig.id),
        draggable: false,
        referrerPolicy: 'no-referrer',
        loading: 'lazy',
        decoding: 'async',
      });
    }

    /* -------------------------------------------------- 猪圈内的行为（游走/发呆） */
    /*
     * 每 1.7 秒给每只猪掷一次骰子：约 28% 发呆，其余挑一个新落脚点。移动本身交给 CSS
     * transition（1.1s），所以位移是平滑的、也不需要 rAF 逐帧改样式——面板开着的时候这是
     * 一整页最省的东西。位置用百分比，猪圈缩放时不需要重算。
     */
    function usePenActors(pigs, disabled) {
      const [actors, setActors] = useState({});
      const signature = pigs.map((p) => p.id).join('|');
      useEffect(() => {
        let alive = true;
        setActors((prev) => {
          const next = {};
          pigs.forEach((pig, index) => {
            const old = prev[pig.id];
            // 死猪：位置一旦定下就不再变，mode 固定为 static，CSS 也不给它任何动画。
            if (pig.kind === 'dead') {
              next[pig.id] = old || {
                x: 20 + (index % 3) * 30,
                y: 32 + Math.floor(index / 3) * 22,
                mode: 'static',
              };
              if (old) next[pig.id] = Object.assign({}, old, { mode: 'static' });
              return;
            }
            // 初始站位按 3 列网格铺开（而不是随机撒点）：随机撒点会让头几只叠在一起，
            // 看上去像一张图而不是一群猪。抖动只加在网格内，保证不越过围栏。
            next[pig.id] = old || {
              x: 20 + (index % 3) * 30 + (Math.random() * 8 - 4),
              y: 32 + Math.floor(index / 3) * 22 + (Math.random() * 6 - 3),
              mode: 'idle',
            };
          });
          return next;
        });
        const timer = setInterval(() => {
          if (!alive) return;
          setActors((prev) => {
            const next = Object.assign({}, prev);
            for (const pig of pigs) {
              const current = next[pig.id] || { x: 50, y: 46, mode: 'idle' };
              if (pig.kind === 'dead' || disabled) { next[pig.id] = Object.assign({}, current, { mode: 'static' }); continue; }
              if (Math.random() < 0.28) { next[pig.id] = Object.assign({}, current, { mode: 'idle' }); continue; }
              next[pig.id] = { x: 14 + Math.random() * 70, y: 24 + Math.random() * 54, mode: 'walk' };
            }
            return next;
          });
        }, 1700);
        return () => { alive = false; clearInterval(timer); };
      }, [signature, disabled]);
      return actors;
    }

    /* --------------------------------------------------------------- 猪圈面板 */
    function PigHubPanel() {
      const [state, setState] = useState(STORE.get());
      useEffect(() => STORE.subscribe(() => setState(STORE.get())), []);
      useEffect(() => { STORE.load(); }, []);

      const penRef = useRef(null);
      /* 猪圈矩形要实时报给 store：桌宠有 30% 的落脚点在猪圈里，而它挂在另一个槽位，
       * 自己量不到这个 DOM。窗口尺寸变化与面板滚动都会让矩形变，所以定时也在量。 */
      useEffect(() => {
        const measure = () => {
          const el = penRef.current;
          if (!el || typeof el.getBoundingClientRect !== 'function') return;
          const rect = el.getBoundingClientRect();
          STORE.setPenRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        };
        measure();
        window.addEventListener('resize', measure);
        const timer = setInterval(measure, 2000);
        return () => { window.removeEventListener('resize', measure); clearInterval(timer); };
      }, []);

      const data = state.data;
      const pigs = (data && data.pigs) || [];
      const pets = (data && data.pets) || [];
      const penPigs = pigs.filter((pig) => pets.indexOf(pig.id) === -1);
      const today = (data && data.today) || { drawn: false, date: '' };
      const catalog = (data && data.catalog) || { count: 0, fetchedAt: '', error: '' };
      const actors = usePenActors(penPigs, REDUCED);

      // 素材：列表与人物的图都换成本地抠完白底的版本（同一份缓存，不重复处理）
      const imageMap = usePigImages(pigs);

      /*
       * 抽取动画：**弹出 → 旋转 → 收进猪圈**。三条设计约束：
       *   1. 起点是**按钮**（你按下的那个），不是屏幕中央 —— 动画要有因果感；
       *   2. 落点取这只猪此刻**真实的 DOM 中心**（不是百分比推算，实测差 18px）；
       *   3. 动画期间真正的猪先隐藏，落定后再出现 —— 「看到它落在哪」与「它就在哪」是同一件事。
       */
      const [reveal, setReveal] = useState(null);
      const drawButtonRef = useRef(null);
      const REVEAL_SIZE = 132;
      const REVEAL_LAND_SCALE = 0.56;
      const POP_MS = 520;
      const FLY_MS = 640;

      const startReveal = (pigId) => {
        const button = drawButtonRef.current;
        const rect = button && typeof button.getBoundingClientRect === 'function' ? button.getBoundingClientRect() : null;
        const from = rect && rect.width > 0
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: (typeof window !== 'undefined' ? window.innerWidth : 800) / 2, y: 120 };
        const sparks = new Array(9).fill(0).map((_, index) => {
          const angle = (Math.PI * 2 * index) / 9 + Math.random() * 0.4;
          const distance = 70 + Math.random() * 60;
          return {
            id: index,
            sx: from.x - 4, sy: from.y - 4,
            ex: from.x - 4 + Math.cos(angle) * distance,
            ey: from.y - 4 + Math.sin(angle) * distance,
          };
        });
        // 先给原图（抠底结果可能还在路上），避免弹出瞬间是空框。
        const store = STORE.get();
        const drawn = store && store.data && Array.isArray(store.data.pigs)
          ? store.data.pigs.filter((pig) => pig.id === pigId)[0]
          : null;
        setReveal({ id: pigId, from, phase: 'pop', target: null, sparks, imageUrl: drawn ? drawn.imageUrl : '' });

        // 起飞前再算落点：这时新猪的落脚点已经分配好了。
        setTimeout(() => {
          const pen = STORE.get().penRect;
          const safeId = String(pigId).replace(/[^a-zA-Z0-9_-]/g, '');
          let target = null;
          try {
            const node = typeof document !== 'undefined'
              ? document.querySelector('.pighub-actor[data-pig="' + safeId + '"]')
              : null;
            const box = node ? node.getBoundingClientRect() : null;
            if (box && box.width > 0) target = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          } catch { /* 量不到就用猪圈中心兜底 */ }
          if (!target && pen && pen.width > 0) target = { x: pen.left + pen.width / 2, y: pen.top + pen.height / 2 };
          setReveal((current) => (current && current.id === pigId ? Object.assign({}, current, { phase: 'fly', target }) : current));
        }, POP_MS);

        setTimeout(() => setReveal((current) => (current && current.id === pigId ? null : current)), POP_MS + FLY_MS + 140);
      };
      /* 活猪被点一下会「弹」一下：加一个 600ms 的 class，CSS 用 squash & stretch 播放。
       * 用 class + 定时器而不是 Web Animations：动画结束撤掉 class 就完全复原，
       * 元素上不会留下一段隐式动画状态。死猪不响应点击（它不动）。 */
      const [squished, setSquished] = useState([]);
      const squish = (id) => {
        setSquished((list) => (list.indexOf(id) >= 0 ? list : list.concat(id)));
        setTimeout(() => setSquished((list) => list.filter((item) => item !== id)), 600);
      };
      const starMode = (data && data.prefs && data.prefs.starDisplay) || 'hover';

      /* 设置浮层。星级显示三档改的是 prefs，落盘在 Host 半，所以刷新/换机器后仍然生效。 */
      const [settingsOpen, setSettingsOpen] = useState(false);
      /*
       * hover 档：划过就记一个「到期时间」，面板每 400ms 重渲染一次来让胶囊自己消失。
       * 用「到期时间 + 轮询」而不是「每只猪一个 setTimeout」：猪的数量是运行期才知道的，
       * 定时器数量不该随之增长；一次 400ms 的重渲染也就几毫秒。
       */
      const hoverRef = useRef({});
      const [, setHoverTick] = useState(0);
      useEffect(() => {
        const timer = setInterval(() => setHoverTick((value) => value + 1), 400);
        return () => clearInterval(timer);
      }, []);
      const markHover = (id) => { hoverRef.current[id] = Date.now() + 5000; setHoverTick((value) => value + 1); };
      const isHoverLive = (id) => (hoverRef.current[id] || 0) > Date.now();

      const onPenPointerDown = useCallback((event, pig) => {
        if (event.button !== undefined && event.button !== 0) return;
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针捕获不可用就退化为普通拖拽 */ }
        }
        STORE.beginDrag({ id: pig.id, imageUrl: pig.imageUrl, title: pig.title, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false });
      }, []);

      const onPenPointerMove = useCallback((event, pig) => {
        const drag = STORE.get().drag;
        if (!drag || drag.id !== pig.id) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const active = drag.active || (dx * dx + dy * dy) > 25;
        STORE.moveDrag(event.clientX, event.clientY, Object.assign({}, drag, { active }));
      }, []);

      const onPenPointerUp = useCallback((event, pig) => {
        const drag = STORE.get().drag;
        STORE.endDrag();
        if (!drag || drag.id !== pig.id || !drag.active) return;
        const rect = STORE.get().penRect;
        const inside = rect
          && event.clientX >= rect.left && event.clientX <= rect.left + rect.width
          && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
        if (inside) return;               // 拖回猪圈内 = 取消，不改变归属
        STORE.setPet(pig.id, true);       // 拖出来 = 原地变成桌宠
        STORE.toast('「' + (pig.title || '猪猪') + '」出门遛弯了，双击可叫回猪圈');
      }, []);

      /* 设置按钮固定在**整个面板的右上角**（不是右栏的右上角）：它是这个页面的设置，
       * 与右栏内容滚动无关，所以用绝对定位挂在面板容器上。 */
      const settings = h('div', { className: 'pighub-settings' },
        h('button', {
          type: 'button',
          className: 'pighub-iconbtn',
          title: 'PigHub 设置',
          'aria-label': 'PigHub 设置',
          'aria-expanded': settingsOpen ? 'true' : 'false',
          onClick: () => setSettingsOpen((open) => !open),
        },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('circle', { cx: 12, cy: 12, r: 3 }),
            h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }),
          ),
        ),
        settingsOpen
          ? h('div', { className: 'pighub-pop' },
              h('h4', null, '星级显示'),
              h('div', { className: 'pighub-seg' },
                [['off', '关闭'], ['hover', '默认'], ['always', '常驻']].map(([mode, label]) =>
                  h('button', {
                    key: mode,
                    type: 'button',
                    'aria-pressed': starMode === mode ? 'true' : 'false',
                    onClick: () => STORE.updatePrefs({ starDisplay: mode }),
                  }, label),
                ),
              ),
              h('div', { className: 'row' }, h('span', null, '默认：划过猪猪显示 5 秒；常驻：一直显示在它上方')),
              h('h4', null, '素材库（本版本冻结）'),
              h('div', { className: 'row' },
                h('span', null, (data && data.assets && data.assets.version ? data.assets.version : '—')
                  + ' · 共 ' + ((data && data.assets && data.assets.total) || 0) + ' 只'
                  + '（活 ' + ((data && data.assets && data.assets.live) || 0) + ' · 死 ' + ((data && data.assets && data.assets.dead) || 0) + '）'),
              ),
              h('h4', null, '下一版候选池（实时目录）'),
              h('div', { className: 'row' },
                h('span', null, (catalog.count || 0) + ' 只 · ' + shortTime(catalog.fetchedAt)),
                h('button', { type: 'button', className: 'pighub-link', onClick: () => STORE.refreshCatalog() }, '立即同步'),
              ),
              (catalog.sources && catalog.sources.length)
                ? h('div', { className: 'pighub-path' },
                    catalog.sources.map((source) => source.id + ' ' + source.count + (source.ok ? '' : '（不可用：' + source.error + '）')).join(' · '),
                  )
                : null,
              h('h4', null, '数据目录'),
              h('div', { className: 'pighub-path' }, (data && data.root) || ''),
            )
          : null,
      );

      /* 抽取动画层：固定定位，坐标即视口坐标（面板没有 transform 祖先）。 */
      const landOffset = REVEAL_SIZE / 2;   // scale/rotate 都绕中心，因此中心 = translate + 半个元素尺寸
      const revealLayer = reveal
        ? h('div', null,
            reveal.phase === 'pop'
              ? reveal.sparks.map((spark) => h('span', {
                  key: 'spark-' + spark.id,
                  className: 'pighub-spark',
                  style: {
                    '--sx': spark.sx + 'px', '--sy': spark.sy + 'px',
                    '--ex': spark.ex + 'px', '--ey': spark.ey + 'px',
                  },
                }))
              : null,
            h('div', {
              className: 'pighub-reveal ' + (reveal.phase === 'pop' ? 'is-pop' : 'is-fly'),
              style: {
                width: REVEAL_SIZE + 'px',
                height: REVEAL_SIZE + 'px',
                transform: reveal.phase === 'pop' || !reveal.target
                  ? 'translate3d(' + (reveal.from.x - landOffset) + 'px,' + (reveal.from.y - landOffset) + 'px,0)'
                  : 'translate3d(' + (reveal.target.x - landOffset) + 'px,' + (reveal.target.y - landOffset) + 'px,0) rotate(720deg) scale(' + REVEAL_LAND_SCALE + ')',
              },
            },
              h('img', {
                src: imageMap[reveal.id] || reveal.imageUrl || '',
                alt: '',
                draggable: false,
                referrerPolicy: 'no-referrer',
              }),
            ),
          )
        : null;

      return h('div', { className: 'pighub-panel' },
        settings,
        revealLayer,
        h('div', { className: 'pighub-left' },
          h('div', { className: 'pighub-pen', ref: penRef },
            h('div', { className: 'pighub-ground' }),
            h('div', { className: 'pighub-fence', 'aria-hidden': true },
              h('i', { className: 't' }), h('i', { className: 'b' }), h('i', { className: 'l' }), h('i', { className: 'r' }),
            ),
            penPigs.length === 0
              ? h('div', { className: 'pighub-empty' }, state.phase === 'loading' ? '正在打开猪圈…' : '猪圈还是空的\n点右边的「今日猪猪」领一只')
              : penPigs.map((pig) => {
                  const actor = actors[pig.id] || { x: 50, y: 46, mode: 'idle' };
                  const motionClass = actor.mode === 'static' ? 'is-static' : (actor.mode === 'walk' ? 'is-walk' : 'is-idle');
                  // 死猪不挂点击：它「只能由用户拖动」，点击这件事对它不存在。
                  const clickProps = pig.kind === 'dead' ? {} : { onClick: () => squish(pig.id) };
                  return h('div', {
                    key: pig.id,
                    'data-pig': pig.id,
                    className: 'pighub-actor ' + motionClass
                      + (squished.indexOf(pig.id) >= 0 ? ' is-squish' : '')
                      + (reveal && reveal.id === pig.id ? ' is-hidden' : ''),
                    style: { left: actor.x + '%', top: actor.y + '%' },
                    onPointerEnter: () => markHover(pig.id),
                  },
                    h(StarBadge, { mode: starMode, stars: pig.stars, visible: isHoverLive(pig.id) }),
                    h('img', {
                      src: imageMap[pig.id] || pig.imageUrl,
                      alt: pig.title || ('猪猪 ' + pig.id),
                      draggable: false,
                      referrerPolicy: 'no-referrer',
                      onPointerDown: (event) => onPenPointerDown(event, pig),
                      onPointerMove: (event) => onPenPointerMove(event, pig),
                      onPointerUp: (event) => onPenPointerUp(event, pig),
                      onPointerCancel: () => STORE.endDrag(),
                      ...clickProps,
                      title: (pig.title || '猪猪') + ' · ' + (pig.kind === 'dead' ? '死猪（静止）' : '活猪（会动）')
                        + ' · ' + starText(pig.stars) + ' · 按住拖出猪圈可当桌宠',
                    }),
                  );
                }),
            state.drag && state.drag.active ? null : null,
          ),
        ),
        h('div', { className: 'pighub-right' },
          h('div', { className: 'pighub-head' },
            h(PixelTitle, null),
            h('button', {
              type: 'button',
              className: 'pighub-draw',
              ref: drawButtonRef,
              disabled: today.drawn || state.phase === 'loading',
              onClick: async () => {
                const payload = await STORE.draw();
                if (payload && payload.draw && payload.draw.ok) startReveal(payload.draw.pigId);
              },
              title: today.drawn ? '每天只能抽一次，明天再来' : '从 PigHub 的猪猪里随机抽一只',
            }, today.drawn ? '今日已获取' : '今日猪猪'),
            h('div', { className: 'pighub-meta' },
              (catalog.count || 0) + ' 只猪猪可选 · 已收集 ' + pigs.length + ' 只 · 抽过 ' + ((data && data.draws) || 0) + ' 次'
              + ' · 猪圈 ' + penPigs.length + ' 只 · 桌宠 ' + pets.length + ' 只'
              + (catalog.error ? ' · 目录暂用缓存（' + catalog.error + '）' : ''),
            ),
          ),
          h('div', { className: 'pighub-sorts' },
            [['time', '按获取时间'], ['stars', '按星级'], ['rarity', '按稀有度']].map(([key, label]) =>
              h('button', {
                key,
                type: 'button',
                className: 'pighub-sort',
                'aria-pressed': ((data && data.sort) || 'time') === key ? 'true' : 'false',
                onClick: () => STORE.sort(key),
              }, label),
            ),
          ),
          h('div', { className: 'pighub-list' },
            pigs.length === 0
              ? h('div', { className: 'pighub-meta' }, '还没有猪猪。今日猪猪每天一次，慢慢喂。')
              : pigs.map((pig) => h('div', { className: 'pighub-row', key: pig.id },
                  pigImage(pig, imageMap[pig.id]),
                  h('div', { className: 'pighub-row-main' },
                    h('div', { className: 'pighub-row-title' }, pig.title || ('猪猪 ' + pig.id)),
                    h('div', { className: 'pighub-row-sub' },
                      '首次获得 ' + shortTime(pig.firstObtainedAt) + ' · 最近升星 ' + shortTime(pig.lastUpgradedAt),
                    ),
                  ),
                  h('span', { className: 'pighub-tag', title: pig.kind === 'dead' ? '死猪：完全静止，只能拖动' : '活猪：会游走，点击会弹一下' }, pig.kind === 'dead' ? '死猪' : '活猪'),
                  pets.indexOf(pig.id) >= 0 ? h('span', { className: 'pighub-tag', title: '这只猪在猪圈外，正作为桌宠待着' }, '桌宠') : null,
                  h('span', { className: 'pighub-tag' }, pig.rarityLabel || pig.rarity),
                  h('span', { className: 'pighub-stars', title: pig.stars + ' 星' }, starText(pig.stars)),
                )),
          ),
        ),
      );
    }

    /* --------------------------------------------------------------- 桌宠层 */
    /*
     * 挂在 shell.overlay 上而不是面板里：面板关掉、切到别的入口，桌宠也该还在桌面上。
     * 容器 pointer-events: none，只有猪本体接收指针——这样它既能在整页游走，又不会挡住
     * 下面任何按钮；与生态里其他桌宠插件（如 dsh-pet，根 z-index 40）各自成层，互不遮挡。
     */
    function PigHubPetLayer() {
      const [state, setState] = useState(STORE.get());
      useEffect(() => STORE.subscribe(() => setState(STORE.get())), []);
      useEffect(() => { if (!STORE.get().data) STORE.load(); }, []);
      const [positions, setPositions] = useState({});
      const [dragId, setDragId] = useState('');
      const offsetRef = useRef({ x: 0, y: 0 });

      const data = state.data;
      const pigs = (data && data.pigs) || [];
      const petIds = (data && data.pets) || [];
      const byId = {};
      for (const pig of pigs) byId[pig.id] = pig;
      const signature = petIds.join('|');
      // 死猪作为桌宠也不动：把 kind 也纳入重算条件，否则换版本后旧签名不会触发重新计时。
      const kindsSignature = petIds.map((id) => (byId[id] ? byId[id].kind : '') || '').join('|');

      /* 每 2.2 秒重新挑落脚点：74% 移动、26% 发呆。约三成的落脚点在猪圈矩形内，
       * 于是「在桌面游走」与「回猪圈里转」是同一套行为，不是两套代码。 */
      useEffect(() => {
        const timer = setInterval(() => {
          const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
          const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
          const pen = STORE.get().penRect;
          setPositions((prev) => {
            const next = Object.assign({}, prev);
            petIds.forEach((id, index) => {
              const current = next[id] || { x: vw * 0.68 + index * 22, y: vh * 0.66 - index * 26 };
              const petPig = byId[id];
              // 死猪：作为桌宠也只待在原地，只有用户拖动才会移动。
              if (petPig && petPig.kind === 'dead') { next[id] = current; return; }
              if (dragId === id || REDUCED || Math.random() < 0.26) { next[id] = current; return; }
              if (pen && pen.width > 0 && Math.random() < 0.3) {
                next[id] = {
                  x: pen.left + pen.width * (0.18 + Math.random() * 0.64),
                  y: pen.top + pen.height * (0.22 + Math.random() * 0.56),
                };
                return;
              }
              next[id] = {
                x: 50 + Math.random() * Math.max(60, vw - 130),
                y: 70 + Math.random() * Math.max(60, vh - 170),
              };
            });
            for (const id of Object.keys(next)) if (petIds.indexOf(id) === -1) delete next[id];
            return next;
          });
        }, 2200);
        return () => clearInterval(timer);
      }, [signature, kindsSignature, dragId]);

      const dragging = state.drag && state.drag.active ? state.drag : null;

      // 桌宠的图也走同一套去白底缓存；星级胶囊与面板里共用同一套三档设置。
      const petPigs = pigs.filter((pig) => petIds.indexOf(pig.id) >= 0);
      const imageMap = usePigImages(petPigs);
      const starMode = (data && data.prefs && data.prefs.starDisplay) || 'hover';
      const hoverRef = useRef({});
      const [, setHoverTick] = useState(0);
      useEffect(() => {
        const timer = setInterval(() => setHoverTick((value) => value + 1), 400);
        return () => clearInterval(timer);
      }, []);
      const markHover = (id) => { hoverRef.current[id] = Date.now() + 5000; setHoverTick((value) => value + 1); };
      const isHoverLive = (id) => (hoverRef.current[id] || 0) > Date.now();

      // 空态要放在**所有 hook 之后**才返回：在 hook 之前分叉会让两次渲染的 hook 数量不同，
      // 真实 React 会直接抛「Rendered fewer hooks than expected」。这条是测试把它抓出来的。
      if (petIds.length === 0 && !dragging && !state.toast) return null;

      return h('div', { className: 'pighub-pets' },
        petIds.map((id) => {
          const pig = byId[id];
          if (!pig) return null;
          // 首帧还没有摆过位置：落在右下角附近，而不是页面原点（否则会贴到左上角）。
          const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 1280;
          const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800;
          const pos = positions[id] || { x: viewportWidth * 0.74, y: viewportHeight * 0.72 };
          const isDragging = dragId === id;
          return h('div', {
            key: id,
            className: 'pighub-pet' + (isDragging ? ' is-drag' : '') + (REDUCED || isDragging || pig.kind === 'dead' ? '' : ' is-idle'),
            style: { left: pos.x + 'px', top: pos.y + 'px', transform: 'translate(-50%,-50%)' },
            title: (pig.title || '猪猪') + ' · 拖动可移动，双击回猪圈',
            onPointerEnter: () => markHover(id),
            onPointerDown: (event) => {
              if (event.button !== undefined && event.button !== 0) return;
              if (typeof event.currentTarget.setPointerCapture === 'function') {
                try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 退化为普通拖拽 */ }
              }
              offsetRef.current = { x: event.clientX - pos.x, y: event.clientY - pos.y };
              setDragId(id);
            },
            onPointerMove: (event) => {
              if (dragId !== id) return;
              const next = { x: event.clientX - offsetRef.current.x, y: event.clientY - offsetRef.current.y };
              setPositions((prev) => Object.assign({}, prev, { [id]: next }));
            },
            onPointerUp: () => setDragId(''),
            onPointerCancel: () => setDragId(''),
            onDoubleClick: () => { STORE.setPet(id, false); STORE.toast('「' + (pig.title || '猪猪') + '」回到猪圈'); },
          },
            h(StarBadge, { mode: starMode, stars: pig.stars, visible: isHoverLive(id) }),
            h('img', {
              src: imageMap[id] || pig.imageUrl,
              alt: pig.title || ('猪猪 ' + id),
              draggable: false,
              referrerPolicy: 'no-referrer',
            }),
          );
        }),
        dragging
          ? h('div', {
              className: 'pighub-pet is-drag',
              style: { left: dragging.x + 'px', top: dragging.y + 'px', transform: 'translate(-50%,-50%)', pointerEvents: 'none' },
            },
              h('img', { src: dragging.imageUrl, alt: dragging.title || '猪猪', draggable: false, referrerPolicy: 'no-referrer' }),
            )
          : null,
        state.toast ? h('div', { className: 'pighub-toast' }, state.toast) : null,
      );
    }
    /* ---------------------------------------------------------------- 注册 */
    /*
     * 三个槽位三种用途，都是**增量贡献**：
     *   sidebar.panellist —— list，必须给 id；order 22 排在 Memory Lab(20)/NewMate(21) 之后
     *   main              —— keyed，key 与 sidebar 的 id 相同，布局据此派发面板
     *   shell.overlay     —— list，页面级浮层，桌宠的家
     * 每个注册都包在 ctx.effect 里，卸载/热重载时自动撤销（否则槽位会留下悬挂贡献）。
     */
    return {
      name: 'dsh-pighub',
      inject: ['slots'],
      apply(ctx) {
        injectCss();

        ctx.effect(
          () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'pighub',
            order: 22,
            label: () => 'PigHub',
          }, PigHubIcon)),
          'pighub-sidebar-entry',
        );

        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pighub' }, PigHubPanel)),
          'pighub-main-panel',
        );

        ctx.effect(
          () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'pighub-pets',
            order: 30,
          }, PigHubPetLayer)),
          'pighub-pet-layer',
        );
      },
    };
  },
});