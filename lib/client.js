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
    /*
     * 猪圈内的层叠档位（**唯一一处写死 z 序的地方**：CSS 规则与每只猪的内联 z-index 都从这里取）。
     * 用户口径（2026-11-14）：「猪猪之间用脚底位置判断遮挡关系，下遮挡上」——
     * 所以猪不再是一个固定 z，而是占**一档区间**，档内按脚底名次排（见 penZIndexMap）。
     *
     * 低 → 高：草坪 0 < 远栏 1 < 小屋 2 < **猪 3..28** < 近栏 30 < 设置 31 < 图鉴 32 < 40（右键菜单/桌宠层 41）。
     * 为什么整档必须留在 40 以下：猪圈自己没有独立的层叠上下文（.pighub-pen 只是 position:relative +
     * overflow:hidden，不构成 stacking context），档位一旦越过 40 就会盖到 .pighub-backdrop/.pighub-menu（40/41）、
     * 桌宠层 .pighub-pets（41）、抽卡演出（59/60/61）与 toast（62）上——那是别人（或者本次演出）的层。
     * 档宽 26 ≥ 猪圈容量 12，留一倍余量：名次最多 12 个，上限 28 永远用不满，但「猪不许压过近栏」是硬约束。
     */
    const Z_GRASS = 0;                    // 草地裁剪盒（不参与命名，留着让档位表读起来完整）
    const Z_FENCE_BACK = 1;               // 远栏：画在所有猪后面
    const Z_HOUSE = 2;                    // 仓库小屋：压后栏、被猪压
    const Z_ACTOR_MIN = 3;                // 猪那一档的下界（一帧零只猪时 CSS 的默认值也是它）
    const Z_ACTOR_SLOTS = 26;             // 档宽（= 能同时站进猪圈的猪数 12 的两倍余量）
    const Z_ACTOR_MAX = Z_ACTOR_MIN + Z_ACTOR_SLOTS - 1;   // 28
    const Z_FENCE_FRONT = 30;             // 近栏：画在所有猪前面（走到底边的猪被挡一截）
    const Z_SETTINGS = 31;                // 设置按钮（必须高于近栏，否则被前景围栏压住）
    const Z_GALLERY = 32;                 // 图鉴覆盖层（必须高于设置与近栏）

    const CSS = [
      '.pighub-panel{position:relative;display:flex;gap:18px;padding:18px;box-sizing:border-box;height:100%;min-height:0;',
      'color:var(--dsw-alias-label-primary,#1f2328);font-family:\'Microsoft YaHei UI\',\'Segoe UI\',\'PingFang SC\',system-ui,sans-serif}',
      '.pighub-panel *{box-sizing:border-box}',
      // 用户口径（2026-11-13）：「拖动的行为要最高覆盖，即拖动不能连带会选中文字」。
      // 面板与桌宠层整体不参与文本选择；拖动过程中还会再给 body 挂一次全局禁选（见 beginDrag/endDrag），
      // 因为拖到面板外面时选区会落到下面的聊天区。
      '.pighub-panel,.pighub-pets{user-select:none;-webkit-user-select:none}',
      'body.pighub-dragging,body.pighub-dragging *{user-select:none !important;-webkit-user-select:none !important;cursor:grabbing !important}',
      '.pighub-left{flex:0 0 auto;display:flex;align-items:flex-start}',
      // 用户口径：「猪圈大一些」。46vmin/400px → 60vmin/560px（本机 1279x752 视口下 451 CSS px）。
      // 上限从 400 提到 560，是为了宽屏时别把右栏挤成一条缝；内容仍受 .pighub-left flex 约束。
      /*
       * 猪圈视觉定调（完整版：archive/pen-design/DESIGN.md）：
       *   坐标系：单位 = 猪圈边长的 1%（452px 下 1 单位 = 4.52px）。
       *     地面 x ∈ [11.5, 88.5]、y ∈ [11.5, 96.5]；围栏外面还留 3.5 单位牧场，
       *     所以围栏是「立在牧场上」，不是贴在画框上当描边。
       *   四条围栏各自站在自己的地面线上、栏身朝上长，四边共用一张 (u,v) 图纸 + 四个 <g transform>。
       *   平涂：不渐变、不打光。柱子靠「圆头 + 方脚 + 底部深色 + 接触影」落地；
       *     四角是加宽的角柱（6.7 单位），两条边的横杆都收在它里面 → 两根柱不再互相穿模；
       *     侧栏和上下栏同族（两道横杆 + 3 根横躺短柱），整圈是一个闭合的方框。
       */
      // 猪圈自己**不画任何像素**：只有「红框内的草坪」和「围栏图」有东西，其余一律 alpha=0，
      // 直接露出宿主页面的底色（用户口径 2026-11-14：「草地和围栏本体之外必须是透明的」）。
      // 圆角保留只是裁切，不填充；一旦要给它一块底色才能圆起来，宁可改方角——这条写在这里当约定。
      '.pighub-pen{position:relative;width:min(60vmin,560px);aspect-ratio:1/1;border-radius:14px;overflow:hidden;',
      'background:transparent}',
      // 草地是一张铺满猪圈的 SVG（见 Meadow）：四块平涂草地 + 草簇，没有渐变。
      // 它被 .pighub-grass-clip 裁到用户红框内（红框外不铺草，草簇也不会溢出去）。
      '.pighub-grass-clip{position:absolute;z-index:' + Z_GRASS + ';overflow:hidden;pointer-events:none}',
      '.pighub-grass{position:absolute;display:block;pointer-events:none}',

      // 仓库小屋：站在草坪**远端**的左上角，**挡住后面的栅栏**。
      // 屋高 = 18% × 34/40 = 15.3%；left 9.7% / top 6.7% → 占 x 9.7%..27.7%、y 6.7%..22.0%。
      // 依据（1254 原图实测）：远栏两道横梁在 y 8.29%..12.28% 与 14.11%..17.46%，整圈远栏到 18.58%；
      // 所以屋身从 6.7% 一路压到 22.0%，把两道横梁整段盖住（重叠高度 17.46−8.29 = 9.17 个百分点）。
      // 屋顶（SVG 顶点在 2.2/34 = 6.7%−0.99% = 5.71%）仍低于角柱帽顶 5.42%，不冒出栅栏剪影。
      // 屋底 22.0% 落在草坪里（红框上沿 18.26%）——它是立在草坪上，不是浮空。
      // 落地阴影是 HouseArt 里同一个 <ellipse>，跟小屋一起走，不会留在原处变成第二个影子。
      // z 序（用户口径 2026-11-14 低→高）：草坪 < 远栏 1 < **小屋 2** < 猪 3..28 < 近栏 30 —— 小屋压住后面的栅栏，
      // 但猪走到它前面时猪在小屋之上。小屋整只都在分割线 50.68% 以上，所以永远不会盖到前景栅栏。
      '.pighub-house{position:absolute;left:9.7%;top:6.7%;width:18%;aspect-ratio:40/34;z-index:' + Z_HOUSE + ';cursor:pointer}',
      '.pighub-house svg{width:100%;height:100%;display:block;overflow:visible}',
      '.pighub-house-wall{fill:color-mix(in oklab,#f2d8b0 84%,var(--dsw-alias-bg-elevated,#fff))}',
      '.pighub-house-wall-sh{fill:color-mix(in oklab,#cba57a 82%,var(--dsw-alias-bg-elevated,#fff))}',
      '.pighub-house-roof{fill:color-mix(in oklab,#dc7148 86%,var(--dsw-alias-bg-elevated,#fff))}',
      '.pighub-house-roof-sh{fill:color-mix(in oklab,#b2552f 86%,var(--dsw-alias-bg-elevated,#fff))}',
      '.pighub-house-plinth{fill:color-mix(in oklab,#c19e74 80%,var(--dsw-alias-bg-base,#fff))}',
      '.pighub-house-door{fill:color-mix(in oklab,#7d4d28 84%,var(--dsw-alias-bg-base,#fff))}',
      '.pighub-house-window{fill:color-mix(in oklab,#ffe2a2 90%,var(--dsw-alias-bg-elevated,#fff))}',
      '.pighub-house-cast{fill:rgba(52,74,24,.18)}',
      // SVG 是替换元素：只写 left/right 而 width:auto 时按内在比例 shrink-to-fit，
      // 在真实宿主里围栏只有猪圈宽度的约 59%（实测 203/346 px）。必须显式 width:100%。
      // ---- 图鉴（未获取的猪：暗色剪影 + 名字打码）----
      '.pighub-gallery{position:absolute;inset:0;z-index:' + Z_GALLERY + ';display:flex;flex-direction:column;gap:8px;',
      'padding:14px 16px;background:color-mix(in oklab,var(--dsw-alias-bg-base,#0b0d10) 92%,transparent);',
      'backdrop-filter:blur(3px);border-radius:12px;overflow:auto}',
      '.pighub-gallery-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.pighub-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}',
      '.pighub-gallery-cell{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;',
      'padding:6px 4px;border-radius:10px;background:color-mix(in oklab,var(--dsw-alias-bg-layer-2,#16181d) 70%,transparent)}',
      '.pighub-gallery-cell img{width:56px;height:56px;object-fit:contain;display:block}',
      // 未获取：整体压暗成剪影
      '.pighub-gallery-cell.is-locked img{filter:brightness(0) saturate(0);opacity:.28}',
      '.pighub-gallery-name{font-size:11px;line-height:1.2;text-align:center;max-width:100%;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-text-secondary,#9aa4b2)}',
      '.pighub-gallery-cell.is-locked .pighub-gallery-name{letter-spacing:.12em;color:var(--dsw-alias-text-tertiary,#6b7280)}',
      '.pighub-gallery-stars{font-size:10px;line-height:1;color:#e8b64c;letter-spacing:.06em}',
      // 图鉴用的次级按钮（不复用 pighub-iconbtn：那是设置齿轮的专属样式，测试也按它选）
      // 图鉴按钮排在设置之后（测试按第一个图标按钮选设置），靠 order 摆到左边
      '.pighub-settings .pighub-ghostbtn{order:-1}',
      '.pighub-ghostbtn{height:26px;padding:0 10px;border-radius:999px;font-size:12px;cursor:pointer;',
      'color:var(--dsw-alias-text-secondary,#9aa4b2);background:color-mix(in oklab,var(--dsw-alias-bg-layer-2,#16181d) 70%,transparent);',
      'border:1px solid color-mix(in oklab,var(--dsw-alias-border-subtle,#2a2f38) 80%,transparent)}',
      // 木栅栏：用户给的一张图（assets/img/pen-fence.png，原样入库）按同一条水平线切两层。
      // 每层 = 一个**溢出裁剪盒**（overflow:hidden，硬边、按整像素归属）+ 盒内一张贴顶/贴底的方块 shot。
      // 不用 clip-path：它的边会抗锯齿，分割线上两层的 alpha 都 <1，顺序合成后那条线会亮出来（实测 +14/255）。
      '.pighub-fence{position:absolute;left:0;right:0;overflow:hidden;pointer-events:none}',
      '.pighub-fence.is-back{top:0;height:50.68%;z-index:' + Z_FENCE_BACK + '}',
      '.pighub-fence.is-front{top:50.68%;bottom:0;z-index:' + Z_FENCE_FRONT + '}',
      // shot 的宽 = 猪圈宽、正方形（猪圈本身就是 1:1），所以两层的缩放与对齐完全一致；
      // 一个贴顶、一个贴底，因此它们画的是同一张图在同一个位置。
      '.pighub-fence-shot{position:absolute;left:0;width:100%;aspect-ratio:1/1;',
      'background-repeat:no-repeat;background-size:100% 100%}',
      '.pighub-fence.is-back .pighub-fence-shot{top:0}',
      '.pighub-fence.is-front .pighub-fence-shot{bottom:0}',
      // 草地四块平涂 + 踩踏土（不是渐变、不是径向）
      '.pighub-field-out{fill:color-mix(in oklab,#a3c479 78%,var(--dsw-alias-bg-base,#fff))}',
      '.pighub-field-base{fill:color-mix(in oklab,#aac97b 78%,var(--dsw-alias-bg-base,#fff))}',
      '.pighub-field-far{fill:color-mix(in oklab,#b8d19c 80%,var(--dsw-alias-bg-base,#fff))}',
      '.pighub-field-near{fill:color-mix(in oklab,#c2ce74 78%,var(--dsw-alias-bg-base,#fff))}',
      '.pighub-field-earth{fill:color-mix(in oklab,#b2a97a 60%,var(--dsw-alias-bg-base,#fff));opacity:.45}',
      '.pighub-tuft{fill:none;stroke:color-mix(in oklab,#5d8a39 64%,var(--dsw-alias-bg-elevated,#fff))}',
      '.pighub-tuft.is-light{stroke:color-mix(in oklab,#ccd98c 70%,var(--dsw-alias-bg-elevated,#fff))}',
      // 朝向：素材绝大多数朝左，所以「向右走」时水平镜像（--pighub-dir:-1）。
      // 位置仍然用 left/top 过渡，但位移本身**不是平移**——外层跑 pighub-travel（一次一跳的位移弧），
      // 内层 img 跑 squash & stretch，两者叠加读起来就是「蹦过去」。
      // 尺寸与桌面桌宠完全一致：固定 96px（不是猪圈宽度的百分比）。
      // z 序与围栏说好：草坪 < 远栏 1 < 小屋 2 < **猪 3..28** < 近栏 30（近栏要能压住走到底边的猪）。
      // 这里的 z-index 只是**没有内联值时**的默认（= 档位下界）；每只猪真正的 z 由 penZIndexMap 按脚底名次算出来，
      // 逐帧写进内联 style（用户口径 2026-11-14：猪猪之间下遮挡上）。
      '.pighub-actor{position:absolute;z-index:' + Z_ACTOR_MIN + ';transform:translate(-50%,-50%) scaleX(var(--pighub-dir,1));width:96px;',
      // 恒速位移：缓动用 linear，具体时长由每只猪的 walkMs（距离/速度）内联覆盖。
      'transition:left 0.9s linear,top 0.9s linear;will-change:left,top}',
      // 拖动中 / 抽取动画中：本体必须真的看不见。只加 class 不写样式 = 原地还留一只（实测踩过）。
      '.pighub-actor.is-hidden{opacity:0 !important;pointer-events:none}',
      // 位移弧的幅度与节拍照搬桌宠的上下起伏（cs:266：hop = |sin(tick/90)| * Size * 0.12）：
      // |sin| 的周期 = π × 90ms ≈ 283ms，幅度 = 0.12 个身位；这里只把「像素」换成「自身高度的百分比」。
      '.pighub-actor.is-walk{animation:pighub-travel .283s ease-in-out infinite}',
      '@keyframes pighub-travel{0%,100%{translate:0 0}50%{translate:0 -12%}}',
      '@keyframes pighub-hop{0%,100%{transform:scale(1,1)}35%{transform:scale(.94,1.07)}70%{transform:scale(1.06,.94)}}',
      '@keyframes pighub-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}',
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
      '.pighub-filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}',
      '.pighub-filter{border:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.3));background:transparent;color:inherit;',
      'border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer}',
      '.pighub-filter[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(226,84,58,.14));',
      'border-color:var(--dsw-alias-border-l2,rgba(226,84,58,.45))}',
      '.pighub-row.is-store{cursor:pointer;opacity:.92}',
      '.pighub-backdrop{position:fixed;inset:0;z-index:40}',
      '.pighub-menu{position:fixed;z-index:41;min-width:150px;padding:6px;border-radius:10px;display:flex;flex-direction:column;gap:2px;',
      'background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.24));',
      'box-shadow:0 10px 30px rgba(0,0,0,.22)}',
      '.pighub-menu-title{padding:4px 8px 6px;font-size:11px;color:var(--dsw-alias-label-secondary,#5a5a5a);',
      'border-bottom:1px solid var(--dsw-alias-border-l2,rgba(120,120,120,.18));margin-bottom:4px}',
      '.pighub-menu button{border:0;background:transparent;color:inherit;text-align:left;padding:6px 8px;border-radius:7px;',
      'font-size:12px;cursor:pointer}',
      '.pighub-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.pighub-menu button[aria-checked="true"]::after{content:" ✓"}',
      '.pighub-settings{position:absolute;right:14px;top:14px;z-index:' + Z_SETTINGS + ';display:flex;gap:6px;align-items:center}',
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
      // 停留期的卡片：深色半透明圆角，压在猪**上方**（不遮挡猪），名字粗体 + 描述小字。
      // 位置由内联 left/top 给（中心对齐窗口中心），淡入淡出靠 is-hold 一个 class 切换。
      '.pighub-reveal-card{position:fixed;left:0;top:0;z-index:61;pointer-events:none;',
      'transform:translate(-50%,-100%) translateY(8px);opacity:0;text-align:center;',
      'min-width:110px;max-width:300px;padding:10px 14px;border-radius:14px;',
      'background:rgba(22,20,18,.78);color:#fff;border:1px solid rgba(255,255,255,.14);',
      'box-shadow:0 10px 26px rgba(0,0,0,.32);',
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
      'transition:opacity .26s ease,transform .26s cubic-bezier(.2,1.2,.4,1)}',
      '.pighub-reveal-card.is-hold{opacity:1;transform:translate(-50%,-100%) translateY(0)}',
      '.pighub-reveal-name{font-size:15px;font-weight:700;line-height:1.35;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pighub-reveal-desc{margin-top:5px;font-size:12px;line-height:1.55;opacity:.84}',
      '.pighub-spark{position:fixed;left:0;top:0;width:9px;height:9px;border-radius:50%;z-index:59;pointer-events:none;',
      'background:radial-gradient(circle,var(--dsw-static-amber-100,#fff3c4) 0%,var(--dsw-static-amber-400,#ffd479) 60%,transparent 70%);',
      'animation:pighub-spark .72s ease-out both}',
      '@keyframes pighub-spark{0%{transform:translate3d(var(--sx),var(--sy),0) scale(.4);opacity:0}25%{opacity:1}100%{transform:translate3d(var(--ex),var(--ey),0) scale(.15);opacity:0}}',
      // 宽 96px、高度自适应 —— 与猪圈本体（.pighub-actor）和原生窗口（size=96，等比高度）完全一致。
      '.pighub-pet{position:absolute;width:96px;height:auto;pointer-events:auto;cursor:grab;transition:left .9s linear,top .9s linear;',
      'transition:left 1.05s linear,top 1.05s linear;touch-action:none}',
      '.pighub-pet img{display:block;width:100%;height:auto;user-select:none;',
      '-webkit-user-drag:none;pointer-events:auto;filter:drop-shadow(0 3px 3px rgba(0,0,0,.3))}',
      '.pighub-pet.is-idle img{animation:pighub-pet-breathe 2.6s ease-in-out infinite}',
      '@keyframes pighub-pet-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}',
      '.pighub-pet.is-drag{transition:none;cursor:grabbing}',
      '.pighub-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:62;pointer-events:none;',
      'background:var(--dsw-alias-toast-bg,#202020);color:var(--dsw-alias-label-primary-foreground,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));',
      'padding:8px 14px;border-radius:999px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.24)}',
      '@media (prefers-reduced-motion: reduce){.pighub-actor,.pighub-pet,.pighub-zz,.pighub-reveal img,',
      '.pighub-reveal-card{animation:none !important;transition:none !important}}',
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

    /* 系统「减少动画」偏好。模块级那个 REDUCED 是**首帧快照**（猪圈/桌宠按它决定要不要走动画）；
     * 抽卡演出是用户按下按钮那一刻才发生的，所以这里每次现问一次——用户中途改系统设置也能立刻生效。 */
    const prefersReducedMotion = () => {
      try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
      } catch { return false; }
    };

    /* ------------------------------------------------ 抽卡演出的常量与纯函数 */
    /* 这些放在 factory 这一层（不在组件里）有两个原因：① CSS 与时间轴要对得上，值只该有一处；
     * ② 测试要能直接拿到它们断言（组件里的东西只能靠渲染才看得到）。 */
    const REVEAL_SIZE = 132;          // 演出元素的方框边长（CSS px）
    const REVEAL_LAND_SCALE = 0.56;   // 落在猪圈时相对方框的缩放（与本体同尺寸）
    const REVEAL_CENTER_SCALE = 1.8;  // 停留时的放大倍数（用户口径：飞到中心放大到 ~1.8 倍）
    const POP_MS = 520;               // 按钮上弹出
    const FLY_MS = 640;               // 飞向中心 / 飞回猪圈，各一段（= CSS 里的 .64s 过渡）
    const HOLD_MS = 2500;             // 中心停留时长（用户口径：停留 2.5 秒）
    const REVEAL_DESC_MAX = 60;       // 描述截断（用户口径：太长截到 ~60 字）
    const REVEAL_TAIL_MS = 140;       // 落定后再撤层的余量，避免最后一帧被截掉

    /** 时间轴：纯算术。测试与报告都引用这一处，不各写一份（taste §Q.9 同口径）。 */
    const revealTimeline = () => ({
      popMs: POP_MS,
      flyMs: FLY_MS,
      holdMs: HOLD_MS,
      holdStart: POP_MS + FLY_MS,
      holdEnd: POP_MS + FLY_MS + HOLD_MS,
      doneAt: POP_MS + FLY_MS + HOLD_MS + FLY_MS + REVEAL_TAIL_MS,
      centerScale: REVEAL_CENTER_SCALE,
      landScale: REVEAL_LAND_SCALE,
      descMax: REVEAL_DESC_MAX,
    });

    /* 描述：取 manifest 里那条的 note（逐图判定理由）。Host 半 2026-11-14 起在快照的
     * pigs[] / pool[] 上各带一份 note；旧包或旧数据没有这个字段时**不渲染描述行**，
     * 而不是编一句话把卡片填满。超长截到 REVEAL_DESC_MAX 个字 + 省略号。 */
    const describePig = (pig) => {
      const raw = pig && (pig.note || pig.description);
      const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
      if (!text) return '';
      return text.length > REVEAL_DESC_MAX ? text.slice(0, REVEAL_DESC_MAX) + '…' : text;
    };

    /* ------------------------------------------- 侧边栏 icon：PigHub 标准 title 小猪 */
    /**
     * 用户口径（2026-11-12）：「侧边栏 icon 用错了，用 pighub 的标准 title 小猪做 icon，向右朝向」。
     *
     * 所以这里不再是手画的几何小猪，而是**标准小猪的轮廓**：从包内 `assets/img/pighub-1114.png`
     * 的 alpha 掩膜描出来的一条外轮廓路径（同一张图＝站内 title 用的那只：左向猪头、卷尾、四条短腿），
     * 再用 `translate(24 0) scale(-1 1)` 水平镜像成**朝右**。
     *
     * 描一次就够：路径写死在这里，运行时零计算，也不引入任何图片请求。
     * 描摹参数可复现：`scripts/_icon-trace.mjs`（220px 掩膜 → vectorise(ε=1.4) → bbox 居中到 24 格，
     * 留 1.8 边距），眼睛位置由 `scripts/_icon-features.mjs` 在源图上按深色连通块量出来再镜像换算。
     */
    /* 原色彩色版（2026-11-13 用户口径：侧边栏 icon 要用原色彩色的，不要变黑白）。
     *
     * 做法：把 assets/img/pighub-1114.png（站内标准 title 小猪）整张图做平涂描摹——
     * vectorise() 量化成 5 个色块（玫红耳/腮、粉身、浅粉高光…），每个色块一条 path，
     * fill 用源图实测色值，不再吃 currentColor；外层 translate(24 0) scale(-1 1) 镜像成朝右。
     * 参数可复现：scripts/_icon-color.mjs（220px -> vectorise(eps=1.3) -> bbox 居中，留 1.2 边距）。
     * 代价是图标不再跟随侧栏配色——这是用户明确要的取舍。
     */
    const PIG_ICON_TRANSFORM = 'translate(1.101 2.240) scale(0.09908)';

    const PIG_ICON_PATHS = [
      { fill: 'rgb(252,124,132)', d: "M207.5 1.0L217.0 1.5L218.5 9.0L209.5 13.0L214.5 20.0L215.5 33.0L210.0 38.5L198.5 39.0L207.5 57.0L209.5 83.0L204.5 102.0L200.5 106.0L200.5 110.0L197.5 114.0L193.5 134.0L191.5 163.0L182.0 170.5L171.0 170.5L166.0 168.5L160.5 162.0L160.5 148.0L156.0 142.5L149.5 144.0L146.5 162.0L142.0 167.5L137.0 169.5L129.0 169.5L122.0 165.5L118.0 153.5L108.5 158.0L107.5 186.0L104.0 192.5L97.0 195.5L83.0 194.5L77.5 190.0L77.5 166.0L76.5 163.0L72.0 160.5L60.0 160.5L58.5 162.0L58.5 181.0L56.0 187.5L50.0 190.5L35.0 189.5L30.5 185.0L29.5 152.0L19.0 144.5L4.5 127.0L0.5 117.0L0.5 96.0L7.5 76.0L16.5 66.0L10.5 62.0L8.5 55.0L23.5 29.0L31.0 22.5L41.0 22.5L52.0 28.5L77.0 16.5L104.0 9.5L152.0 9.5L179.0 18.5L184.0 9.5L190.0 6.5L197.0 6.5L203.0 1.5L207.0 1.5ZM205.5 3.0L215.0 2.5L217.5 6.0L215.0 9.5L207.5 13.0L212.5 19.0L213.5 33.0L207.0 37.5L198.0 35.5L196.5 37.0L206.5 59.0L208.5 80.0L192.5 129.0L189.5 163.0L183.0 168.5L168.0 167.5L162.5 162.0L161.5 144.0L151.0 140.5L147.5 144.0L145.5 160.0L140.0 166.5L129.0 167.5L121.5 161.0L119.0 151.5L109.0 155.5L106.5 159.0L105.5 188.0L98.0 193.5L83.0 192.5L78.5 188.0L78.5 163.0L74.0 159.5L59.0 159.5L57.5 161.0L56.5 182.0L53.0 187.5L35.0 187.5L31.5 178.0L30.5 150.0L19.0 142.5L11.5 134.0L2.5 117.0L1.5 101.0L8.5 78.0L17.5 67.0L18.0 63.5L31.0 61.5L38.5 53.0L38.5 50.0L35.0 48.5L25.0 56.5L18.5 55.0L30.5 34.0L38.5 25.0L52.0 30.5L65.0 23.5L69.0 23.5L90.0 14.5L128.0 9.5L152.0 11.5L179.0 20.5L186.0 10.5L197.0 8.5L205.0 3.5ZM29.5 27.0L30.5 28.0L20.5 42.0L18.0 43.5L18.5 40.0L29.0 27.5ZM14.5 46.0L16.5 46.0L14.0 51.5L14.5 47.0ZM101.5 53.0L106.5 54.0L102.5 61.0L104.5 68.0L117.0 81.5L122.0 81.5L126.5 76.0L126.5 59.0L129.0 58.5L132.5 62.0L133.5 78.0L130.5 85.0L126.0 89.5L119.0 90.5L111.0 87.5L103.5 81.0L95.5 66.0L95.5 60.0L101.0 53.5ZM11.5 54.0L13.5 54.0L13.5 60.0L15.5 62.0L11.5 60.0L11.0 54.5ZM30.5 75.0L37.0 74.5L41.5 79.0L42.5 89.0L36.0 94.5L30.0 93.5L27.5 91.0L24.5 86.0L26.5 78.0L30.0 75.5ZM85.5 86.0L91.0 85.5L96.5 91.0L97.5 98.0L95.5 101.0L88.0 105.5L81.5 102.0L79.5 99.0L79.5 91.0L85.0 86.5ZM34.5 101.0L46.0 100.5L59.0 105.5L68.5 118.0L66.5 128.0L60.0 133.5L53.0 134.5L31.0 129.5L23.5 122.0L21.5 111.0L27.0 103.5L34.0 101.5Z" },
      { fill: 'rgb(252,212,180)', d: "M209.5 4.0L213.0 4.5L214.5 7.0L206.0 9.5L204.5 11.0L205.5 14.0L203.0 16.5L192.0 16.5L187.5 20.0L187.5 31.0L198.5 46.0L205.5 64.0L204.5 90.0L197.5 102.0L197.5 107.0L191.5 121.0L190.5 138.0L187.5 142.0L187.5 161.0L181.0 166.5L170.0 166.5L164.5 160.0L164.5 147.0L161.0 140.5L153.0 137.5L136.0 140.5L126.0 144.5L118.0 150.5L112.0 150.5L104.5 155.0L104.5 181.0L103.5 185.0L97.0 191.5L87.0 191.5L81.5 186.0L80.5 160.0L78.0 157.5L71.0 156.5L57.0 156.5L54.5 162.0L54.5 182.0L48.0 187.5L40.0 186.5L33.5 181.0L33.5 148.0L29.0 146.5L19.0 137.5L6.5 122.0L3.5 100.0L9.5 81.0L20.5 72.0L19.5 68.0L21.0 66.5L36.0 62.5L42.5 50.0L41.0 46.5L33.0 43.5L28.0 49.5L26.5 49.0L27.5 45.0L33.5 38.0L33.5 34.0L43.0 28.5L46.0 32.5L57.0 32.5L61.0 27.5L80.0 19.5L111.0 12.5L146.0 12.5L161.0 15.5L165.0 18.5L182.0 23.5L184.5 22.0L184.5 17.0L188.0 11.5L200.0 11.5L206.0 4.5L209.0 4.5ZM207.5 20.0L209.0 19.5L211.5 24.0L211.5 29.0L210.0 29.5L207.5 21.0ZM196.5 22.0L198.5 22.0L196.5 23.0ZM200.5 32.0L208.5 32.0L206.0 35.5L200.5 33.0ZM102.5 51.0L108.0 50.5L110.5 53.0L110.5 58.0L106.5 61.0L106.5 64.0L112.5 73.0L112.5 76.0L119.0 78.5L123.5 77.0L123.5 58.0L131.0 55.5L133.5 57.0L137.5 71.0L136.5 80.0L132.5 87.0L134.5 92.0L133.0 93.5L126.0 91.5L113.0 92.5L110.0 88.5L107.0 88.5L101.5 84.0L94.5 72.0L93.5 61.0L94.5 56.0L102.0 51.5ZM32.5 73.0L38.0 72.5L44.5 78.0L41.5 92.0L35.0 95.5L26.5 90.0L24.5 82.0L32.0 73.5ZM82.5 85.0L93.0 84.5L99.5 91.0L97.5 100.0L90.0 105.5L83.0 105.5L78.5 97.0L82.0 85.5ZM32.5 98.0L47.0 97.5L66.0 104.5L73.5 116.0L70.5 130.0L67.0 130.5L64.0 135.5L58.0 135.5L56.0 137.5L27.0 132.5L19.5 123.0L18.5 112.0L23.5 103.0L32.0 98.5Z" },
      { fill: 'rgb(252,172,172)', d: "M38.5 26.0L41.5 26.0L38.0 29.5L35.5 29.0L38.0 26.5ZM27.5 28.0L30.5 28.0L27.0 31.5L27.0 28.5ZM34.5 30.0L35.5 31.0L27.5 43.0L25.0 45.5L24.5 44.0L34.0 30.5ZM24.5 32.0L26.5 32.0L24.5 36.0L22.5 37.0L24.0 32.5ZM21.5 38.0L22.5 39.0L21.0 40.5L21.0 38.5ZM19.5 41.0L20.5 42.0L19.0 43.5L19.0 41.5ZM14.5 46.0L16.5 46.0L14.0 51.5L14.5 47.0ZM23.5 46.0L22.0 55.5L30.5 52.0L25.0 56.5L20.0 56.5L18.5 53.0L23.0 46.5ZM33.5 48.0L40.5 49.0L40.5 53.0L37.5 57.0L31.5 61.0L38.5 53.0L37.0 48.5L33.0 48.5ZM100.5 52.0L106.0 51.5L108.5 54.0L104.5 60.0L104.5 65.0L109.5 73.0L118.0 80.5L123.5 77.0L124.5 60.0L126.5 60.0L126.5 76.0L124.5 79.0L122.0 81.5L117.0 81.5L108.5 74.0L102.5 62.0L106.5 55.0L105.0 52.5L102.0 52.5L95.5 60.0L96.5 69.0L103.5 81.0L97.5 76.0L94.5 69.0L94.5 58.0L100.0 52.5ZM128.5 58.0L134.5 62.0L135.5 78.0L132.5 85.0L127.0 89.5L133.5 78.0L133.5 65.0L129.0 58.5ZM29.5 62.0L31.5 62.0L28.0 64.5L20.5 64.0L29.0 62.5ZM38.5 76.0L40.0 75.5L43.5 80.0L43.0 86.5L42.5 81.0L39.0 76.5ZM87.5 85.0L91.0 84.5L88.0 85.5ZM107.5 86.0L119.0 90.5L126.0 89.5L125.0 91.5L117.0 91.5L108.0 86.5ZM37.5 99.0L46.0 98.5L53.0 100.5L66.5 110.0L70.5 118.0L67.5 130.0L60.0 135.5L42.0 135.5L30.0 130.5L21.5 122.0L19.5 109.0L27.0 101.5L37.0 99.5ZM34.5 101.0L46.0 100.5L59.0 105.5L68.5 118.0L66.5 128.0L60.0 133.5L53.0 134.5L31.0 129.5L23.5 122.0L21.5 111.0L27.0 103.5L34.0 101.5ZM89.5 104.0L91.5 104.0L89.0 104.5ZM139.5 142.0L145.5 143.0L143.5 160.0L137.0 165.5L127.0 165.5L123.5 162.0L123.5 150.0L139.0 142.5Z" },
      { fill: 'rgb(252,212,188)', d: "M205.5 3.0L215.0 2.5L217.5 6.0L215.0 9.5L207.5 13.0L212.5 19.0L213.5 33.0L207.0 37.5L198.0 35.5L196.5 37.0L206.5 59.0L208.5 80.0L205.5 93.0L196.5 113.0L192.0 133.5L190.5 133.0L191.5 121.0L197.5 107.0L197.5 102.0L204.5 90.0L205.5 64.0L198.5 46.0L187.5 31.0L187.5 20.0L192.0 16.5L203.0 16.5L205.5 14.0L204.5 11.0L206.0 9.5L214.5 7.0L213.0 4.5L206.0 4.5L200.0 11.5L188.0 11.5L184.5 17.0L184.5 22.0L182.0 23.5L165.0 18.5L161.0 15.5L128.0 11.5L98.0 14.5L92.0 17.5L83.0 18.5L61.0 27.5L57.0 32.5L46.0 32.5L41.5 26.0L52.0 30.5L65.0 23.5L69.0 23.5L90.0 14.5L128.0 9.5L152.0 11.5L179.0 20.5L186.0 10.5L197.0 8.5L205.0 3.5ZM207.5 20.0L209.0 19.5L211.5 24.0L211.5 29.0L210.0 29.5L207.5 21.0ZM196.5 22.0L198.5 22.0L196.5 23.0ZM38.5 25.0L40.0 24.5L39.0 25.5ZM25.5 30.0L26.5 31.0L25.0 30.5ZM200.5 32.0L208.5 32.0L206.0 35.5L200.5 33.0ZM21.5 36.0L22.5 37.0L21.0 38.5L21.0 36.5ZM19.5 39.0L20.5 40.0L19.0 41.5L19.0 39.5ZM11.5 54.0L14.5 61.0L11.5 60.0L11.0 54.5ZM17.5 64.0L20.5 65.0L20.5 72.0L9.5 81.0L3.5 100.0L3.5 109.0L6.5 116.0L6.5 122.0L12.5 131.0L29.0 146.5L33.5 148.0L33.5 181.0L40.0 186.5L48.0 187.5L54.5 182.0L55.5 158.0L57.0 156.5L78.0 157.5L80.5 160.0L81.5 186.0L87.0 191.5L97.0 191.5L103.5 185.0L104.5 165.0L106.5 165.0L105.5 188.0L98.0 193.5L83.0 192.5L78.5 188.0L78.5 163.0L74.0 159.5L59.0 159.5L57.5 161.0L56.5 182.0L53.0 187.5L38.0 188.5L33.5 186.0L30.5 168.0L30.5 150.0L19.0 142.5L11.5 134.0L2.5 117.0L1.5 101.0L5.5 84.0L17.5 65.0ZM147.5 138.0L153.0 137.5L162.5 142.0L164.5 147.0L164.5 160.0L170.0 166.5L181.0 166.5L188.5 159.0L187.5 142.0L191.0 137.5L192.5 141.0L189.5 163.0L183.0 168.5L168.0 167.5L162.5 162.0L161.5 144.0L151.0 140.5L147.5 144.0L147.5 152.0L144.5 162.0L140.0 166.5L129.0 167.5L128.0 165.5L137.0 165.5L143.5 160.0L145.5 153.0L145.5 139.0L147.0 138.5ZM120.5 149.0L123.5 162.0L121.5 161.0L120.5 153.0L118.0 151.5L109.0 155.5L104.5 163.0L104.5 155.0L107.0 152.5L120.0 149.5Z" },
      { fill: 'rgb(252,204,180)', d: "M40.5 27.0L42.0 26.5L42.5 29.0L40.0 31.5L36.0 31.5L35.5 30.0L40.0 27.5ZM32.5 34.0L33.5 38.0L27.5 45.0L26.5 49.0L28.0 49.5L33.0 43.5L41.0 46.5L42.5 50.0L41.0 51.5L39.0 47.5L34.0 47.5L26.0 54.5L21.5 55.0L24.5 46.0L32.0 34.5ZM102.5 51.0L108.0 50.5L110.5 53.0L110.5 58.0L106.5 61.0L106.5 64.0L112.5 73.0L112.0 75.5L104.5 65.0L104.5 60.0L108.5 54.0L103.0 51.5ZM96.5 54.0L98.5 54.0L95.0 57.5L96.0 54.5ZM38.5 55.0L39.5 58.0L37.5 61.0L31.5 62.0L38.0 55.5ZM130.5 56.0L132.0 55.5L135.5 61.0L136.5 80.0L134.5 81.0L134.5 62.0L130.0 57.5L124.5 60.0L123.5 74.0L123.5 58.0L130.0 56.5ZM28.5 64.0L30.5 64.0L29.0 65.5L24.0 66.5L20.5 65.0L28.0 64.5ZM94.5 70.0L97.5 74.0L97.0 75.5L94.5 71.0ZM32.5 73.0L38.0 72.5L39.5 75.0L32.0 73.5ZM41.5 77.0L43.0 76.5L44.5 80.0L42.0 77.5ZM114.5 77.0L121.5 79.0L118.0 80.5L114.5 78.0ZM98.5 78.0L109.5 88.0L107.0 88.5L103.0 85.5L98.5 79.0ZM133.5 83.0L132.5 88.0L134.5 92.0L131.0 93.5L125.5 91.0L133.0 83.5ZM82.5 85.0L85.5 86.0L82.0 88.5L82.0 85.5ZM91.5 85.0L99.5 91.0L98.0 95.5L92.0 85.5ZM111.5 90.0L121.5 92.0L113.0 92.5L111.5 91.0ZM40.5 91.0L41.5 92.0L39.0 93.5L40.0 91.5ZM32.5 94.0L35.0 93.5L33.0 94.5ZM32.5 98.0L47.0 97.5L55.0 99.5L59.5 103.0L46.0 98.5L32.0 98.5ZM96.5 99.0L97.5 100.0L96.0 101.5L96.0 99.5ZM28.5 100.0L30.5 100.0L25.0 103.5L23.5 103.0L28.0 100.5ZM81.5 103.0L85.5 105.0L81.5 104.0ZM59.5 104.0L66.0 104.5L73.5 116.0L69.0 131.5L67.5 129.0L70.5 118.0L66.5 110.0L60.0 104.5ZM18.5 112.0L21.5 122.0L30.0 130.5L37.5 134.0L32.0 134.5L24.5 130.0L19.5 123.0L18.5 113.0ZM64.5 132.0L66.5 132.0L65.5 134.0L61.0 135.5L64.0 132.5ZM189.5 134.0L192.5 134.0L192.0 138.5L189.5 135.0ZM45.5 136.0L57.0 135.5L56.0 137.5L46.0 136.5ZM143.5 139.0L145.5 139.0L145.0 142.5L140.0 141.5L134.0 143.5L129.0 147.5L126.0 147.5L122.0 153.5L121.5 148.0L136.0 140.5L143.0 139.5ZM105.5 163.0L106.5 164.0L105.0 163.5Z" },
    ];

    function PigHubIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24',
        'aria-hidden': true, focusable: false, style: { display: 'block' },
      },
        h('g', { transform: 'translate(24 0) scale(-1 1)' },
          h('g', { transform: PIG_ICON_TRANSFORM },
            PIG_ICON_PATHS.map((item, index) => h('path', { key: 'p' + index, d: item.d, fill: item.fill, fillRule: 'evenodd' })),
          ),
        ),
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

    /** 每只猪最后一次「由本客户端写入」位置的时间戳（毫秒）。用来判断快照里的位置是不是更新。 */
    const lastPosSent = {};
    /*
     * 每只猪最后一次「由本客户端写入」的**坐标**（百分比）。时间戳那条路在真机上不成立：
     * 宿主快照里没有 posAt（lib/store.js 的 normaliseState 不落这个字段，见 archive/drag-drop-origin.md），
     * 所以 hostAt 恒为 0。于是「快照里的位置是不是我们自己的回声」只能靠**值**来判：
     * 宿主回传的落点就是我们写下去的那一版 → 不该再"采纳"一次（那就是第二段位移）。
     */
    const lastPosWritten = {};
    /** 上一次快照的序列化结果：轮询拿回同样的内容时不触发重渲染。 */
    let lastPayload = '';

    /** 面板注册的「把某只猪摆到落点」实现；桌宠层不需要，所以允许为空。 */
    let moveActorHandler = null;
    /** 上一次上报给宿主的猪圈矩形（节流用）。 */
    let STORE_LAST_PEN = null;

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

      /** 拖动期间全局禁选（见 CSS 里的 body.pighub-dragging）。 */
      function setBodyDragging(on) {
        if (typeof document === 'undefined' || !document.body) return;
        try { document.body.classList.toggle('pighub-dragging', !!on); } catch { /* 宿主没有 body 就跳过 */ }
      }

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
        if (!state.data) set({ phase: 'loading' });
        try {
          const payload = await request({ action: 'state' });
          // 10 秒轮询用：内容一模一样就别 set，省掉一次整面板重渲染。
          const serialised = JSON.stringify(payload);
          if (serialised === lastPayload) return;
          lastPayload = serialised;
          apply(payload);
        } catch (error) { set({ phase: 'error', error: String((error && error.message) || error) }); }
      }

      /*
       * 轮询对账（2026-11-14 补）：桌宠在桌面上的时候，**宿主/原生窗口可以绕过浏览器半改状态**
       * （双击回圈、拖回猪圈、右键切运动），浏览器半只能靠轮询知道。原来只有 10 s 一轮的整张快照，
       * 实测「猪已经被叫回猪圈、猪圈里却空着」的空窗 0.16–8.36 s；两次相隔 1.1 s 的动作，
       * 落到界面上却相隔 10.03 s —— 那就是 10 s 轮询的相位，不是渲染慢
       *（archive/20261114-135230-pet-return-continuity）。
       *
       * 所以桌宠在场时改成 250 ms 一次的**令牌对账**：宿主只回一个几十字节的 rev，
       * 变了才拉整张快照（38 KB / 256 条图鉴）。没桌宠时仍是 10 s 一轮（那时改状态的只有自己，
       * 而自己的每个动作都已经用响应里的快照 apply 过了，不必等轮询）。
       */
      let lastRev = '';
      let revBusy = false;
      let revUnsupported = false;
      /**
       * 对一次账。回 true = 「这一拍已经处理过了」（令牌没变，或问过了）；
       * 回 false = 「这个宿主没有 rev 动作」——调用方要退回 10 s 整张快照，
       * 否则桌宠在场时 tick 会一直停在令牌分支上，一次快照都不再拉（比原来更糟）。
       */
      async function syncRev() {
        if (revUnsupported) return false;
        if (revBusy) return true;
        revBusy = true;
        try {
          const payload = await request({ action: 'rev' });
          if (payload && typeof payload.rev === 'string') {
            if (payload.rev !== lastRev) { lastRev = payload.rev; await load(); }
            return true;
          }
          // 只有「宿主明确不认识这个动作」才算降级。插件正在重载时那一拍的 404/网络错误**不能**
          // 把客户端永久锁在 10 s 路径上——真机上踩过：reload 正好落在一拍里，revUnsupported 粘住，
          // 空窗又变回几秒（archive/20261114-135230-pet-return-continuity §5.2）。
          if (payload && payload.error === 'unknown_action') { revUnsupported = true; return false; }
          return true;
        } catch { return true; } finally { revBusy = false; }
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
        return place(pigId, pet ? 'pet' : 'pen');
      }

      /** 三态放置：猪圈 / 桌宠 / 库存（仓库）。库存的猪不再渲染，也就不再加载贴图。 */
      async function place(pigId, to) {
        try {
          const payload = await request({ action: 'place', pigId, to });
          apply(payload);
          // 猪圈满 12 只时宿主会把猪改放进仓库，并回一个 capped 标记——不告诉用户，他会以为点丢了。
          if (payload && payload.placement && payload.placement.capped) {
            toast('猪圈满了（最多 ' + (payload.penCap || 12) + ' 只），先住进仓库了');
          }
          return payload;
        } catch (error) { set({ error: String((error && error.message) || error) }); return null; }
      }

      /**
       * 记住落脚点（百分比）。走动与拖放都会调；宿主写进 state.json 的 pig.pos。
       * 带一个时间戳：宿主会把它一起存下来，快照回传后客户端**只采纳比自己这次写入更新**的位置。
       * 没有这个戳的话，10 秒轮询拿回来的旧快照会把正在走的猪拽回上一个点（这就是「游走回退」）。
       */
      async function savePosition(pigId, x, y) {
        const at = Date.now();
        lastPosSent[pigId] = at;
        lastPosWritten[pigId] = { x: Number(x), y: Number(y) };
        try {
          await request({ action: 'position', pigId, x, y, at });
        } catch { /* 位置上报失败不该影响游玩，下一轮会再报 */ }
      }

      /** 逐只配置「允许运动 / 保持静止」。null 表示回到默认（按 kind）。 */
      async function setMotion(pigId, motion) {
        try { apply(await request({ action: 'motion', pigId, motion })); }
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
        get, set, subscribe, toast, load, syncRev, draw, sort, setPet, place, setMotion, savePosition, updatePrefs, refreshCatalog,
        // 拖动期间给 body 挂全局禁选：拖到面板外面时，选区不会落到下面的聊天区。
        beginDrag: (drag) => { setBodyDragging(true); set({ drag }); },
        moveDrag: (x, y, drag) => set({ drag: Object.assign({}, drag, { x, y }) }),
        endDrag: () => { setBodyDragging(false); set({ drag: null }); },
        /** 把桌面落点（物理像素）报给宿主：原生桌宠启动时就用它当初始坐标。 */
      setDesktopPos: (pigId, x, y) => request({ action: 'desktopPos', pigId, x, y }).catch(() => {}),
      /** 拖出猪圈 / 拖动桌宠后给它的**初始屏幕坐标**（用户口径：松手处就是它落地的位置）。 */
      seedPet: (id, x, y) => set({ seedPos: Object.assign({}, STORE.get().seedPos || {}, { [id]: { x, y } }) }),
      setPenRect: (rect) => {
        set({ penRect: rect });
        // 桌面桌宠是另一个进程，它不知道 DOM 里猪圈在哪——把矩形报给宿主，宿主再下发。
        // 节流：只有明显变化（>4px 或尺寸变了）才发。
        const last = STORE_LAST_PEN;
        const moved = !last || Math.abs(last.left - rect.left) > 4 || Math.abs(last.top - rect.top) > 4
          || Math.abs(last.width - rect.width) > 4 || Math.abs(last.height - rect.height) > 4;
        if (!moved) return;
        STORE_LAST_PEN = rect;
        // 坐标必须换算成**物理像素**：原生窗口是 per-monitor DPI aware，看到的是物理坐标系，
        // 而 getBoundingClientRect() 给的是 CSS px（本机 DPR=2）。不换算就差一倍，拖回猪圈永远判不中。
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        request({
          action: 'penRect',
          dpr,
          rect: { left: rect.left * dpr, top: rect.top * dpr, width: rect.width * dpr, height: rect.height * dpr },
        }).catch(() => {});
      },
      // 拖拽落点在猪圈内：把这只猪摆到落点（由面板注册 actor 的 setter 实现）。
      moveActorTo: (pigId, x, y) => { if (typeof moveActorHandler === 'function') moveActorHandler(pigId, x, y); },
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
    /**
     * 素材是**包内文件**：这里只按猪 id 建索引，不做任何处理。
     * 去白底、裁到猪身、描摹成 SVG 都在构建期完成（scripts/build-assets.mjs），
     * 运行时不联网、不占用户算力。
     */
    function usePigImages(pigs) {
      const map = {};
      for (const pig of pigs) if (pig && pig.id) map[pig.id] = pig.assetUrl || pig.imageUrl || '';
      return map;
    }
    /* ------------------------------------------------------------- 木栅栏（两层） */
    /*
     * 围栏是**用户给的一张图**：assets/img/pen-fence.png（1254×1254，逐字节原样入库）。
     * 不重画、不改色、不拉伸——只做两件事：去掉与画布边缘连通的近白底（这张图本来就没有，
     * 规则跑完命中 0 像素，读数见 scripts/pen-fence-split.py），再按**同一条水平线**切成
     * 远/近两层（上半归远、下半归近，每行只属于一层，像素一份不差）。
     *
     *   远层 .is-back ：顶横梁 + 上角立柱/草石 + 左右侧栏的上半 → 画在猪**后面**（z 1）
     *   近层 .is-front：底横梁 + 下角立柱/草石 + 左右侧栏的下半 → 画在猪**前面**（z 4）
     * 于是猪从中间走过时头压住远栏（猪在远栏之前）、身子被近栏挡住（近栏在猪之前）。
     *
     * 为什么是「溢出裁剪盒 + 贴顶/贴底 shot」而不是 clip-path 或预切两张图：
     *   clip-path 的边会抗锯齿 → 分割线上两层 alpha 都 <1，顺序合成后那条线会亮出来
     *   （实测 452px 下 53 px 宽的一条，绿色通道 +14/255；预切图 +18/255）。
     *   溢出裁剪是**硬边、按整像素归属**，每行只归一层，两层叠回去与单层整图一致
     *   （实测差 166 px / ≤4/255，而「同一张图渲染两次」的对照差是 167 px / ≤4/255，
     *    即那点差是渲染器的亚像素相位噪声，不是缝）。
     */
    const PEN_FENCE_URL = '/pighub/pen/pen-fence.png';
    /* 分割线（%）= 1254 原图第 636 行：内圈竖直中点 (247+1024)/2 = 635.5 取上行 → 636/12.54。 */
    const PEN_FENCE_SPLIT = 50.68;
    /* 栅栏内圈（%）：原图里**最大的、不含任何可见栅栏像素**的矩形（px x 168..1085、y 247..1024）。
     * 四条边由「最凸出的那一点」决定：螺栓探到 166/1087、侧栏内面 150/1104、
     * 远栏立柱探到 234、近栏立柱探到 1028（读数见 scripts/_pen-fence-probe.py）。 */
    const PEN_INNER = { x0: 13.40, x1: 86.60, y0: 19.70, y1: 81.74 };
    /* 用户红框（%）：草坪只能铺在这里。取标注线**外沿**（线宽 21–22 px，内外沿本就差 1.7%）：
     * 远栏底面在 y 18.7%、红框内沿在 20.02%，取内沿会在栏下留一条「没有草」的亮带。 */
    const PEN_GRASS = { x0: 8.37, x1: 91.47, y0: 18.26, y1: 96.65 };

    function penRound(value) {
      return Math.round(value * 100) / 100;
    }

    /* ---------------- 主题包（用户口径 2026-11-14） ----------------
     * 快照里的 activeTheme 已经在宿主侧逐字段回落过 classic，所以这里只做「取到就用、取不到就用常量」。
     * geometry 存的是 [left, top, right, bottom]（百分比），客户端内部用的是 {x0,x1,y0,y1}。 */
    const CLASSIC_THEME_FALLBACK = { name: 'classic' };
    function themeRect(list, fallback) {
      if (!Array.isArray(list) || list.length !== 4) return fallback;
      const [left, top, right, bottom] = list.map((n) => Number(n));
      if (![left, top, right, bottom].every((n) => Number.isFinite(n)) || !(left < right) || !(top < bottom)) return fallback;
      return { x0: left, x1: right, y0: top, y1: bottom };
    }
    /** 主题里某一张图的 URL；没有就用包内那张默认布景（观感与主题化之前完全一致）。 */
    function themeFenceUrl(theme, which) {
      const name = theme && theme.name ? String(theme.name) : 'classic';
      const fence = (theme && theme.fence) || {};
      const file = (which === 'front' ? fence.front : fence.back) || fence.image || '';
      if (!file) return '/pighub/pen/pen-fence.png';
      return '/pighub/theme/' + encodeURIComponent(name) + '/' + encodeURIComponent(String(file));
    }

    /** 一层栅栏：裁剪盒只决定「看得到哪一半」，盒里的 shot 永远是整张图、贴在猪圈的位置上。 */
    function PenFence(props) {
      const front = !!(props && props.front);
      const theme = (props && props.theme) || CLASSIC_THEME_FALLBACK;
      const splitRatio = theme.fence && Number(theme.fence.split);
      const split = penRound(Number.isFinite(splitRatio) && splitRatio > 0.05 && splitRatio < 0.95
        ? splitRatio * 100
        : PEN_FENCE_SPLIT);
      return h('div', {
        className: 'pighub-fence ' + (front ? 'is-front' : 'is-back'),
        style: front ? { top: split + '%', bottom: 0 } : { top: 0, height: split + '%' },
        'aria-hidden': true,
      },
        h('div', {
          className: 'pighub-fence-shot',
          style: { backgroundImage: 'url("' + themeFenceUrl(theme, front ? 'front' : 'back') + '")' },
        }),
      );
    }
    /* ---------------------------------------------------------------- 草地 */
    /*
     * 用户口径「不要一块纯色渐变」。这里是四块**平涂**草地 + 一群草簇：
     *   外围牧场（深半档，围栏才有「立在牧场里」的分离）→ 地面主色 → 远坡（冷浅）→ 近坡（黄暖）。
     * 远坡/近坡是波浪边（形状软、边界硬），所以不像三条色带。
     * 草簇用固定种子生成，保证每次渲染一模一样（不会换一次面板就换一片草）。
     */
    function penTufts() {
      let seed = 20261113;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const list = [];
      // 只在草坪里撒草簇。原先还有 9 簇画在猪圈最外圈的牧场边（y 1~3），
      // 现在那一圈在用户红框之外、不再铺草，所以整段删掉——留着就是看不见的死数据。
      for (let i = 0; i < 26; i += 1) {
        const y = 14 + rand() * 78;
        list.push({ x: 13 + rand() * 74, y, s: 0.8 + (y / 100) * 0.75, lean: rand() * 1.2 - 0.6, light: i % 3 === 0 });
      }
      return list;
    }
    const PEN_TUFTS = penTufts();

    function penTuftPath(t) {
      const s = t.s;
      const lean = t.lean;
      const x = penRound(t.x);
      const y = penRound(t.y);
      const blade = (dx, height, k) => 'M ' + penRound(x + dx) + ' ' + penRound(y + Math.abs(dx) * 0.28)
        + ' Q ' + penRound(x + dx + lean * k * s) + ' ' + penRound(y - height * 0.5 * s)
        + ' ' + penRound(x + dx + lean * 2.3 * k * s) + ' ' + penRound(y - height * s);
      return blade(-0.45, 1.5, 0.45) + ' ' + blade(0.05, 2.05, 0.9) + ' ' + blade(0.55, 1.25, 0.3);
    }

    function Meadow(props) {
      const theme = (props && props.theme) || CLASSIC_THEME_FALLBACK;
      const geo = theme.geometry || {};
      const G = themeRect(geo.grass, PEN_GRASS);
      const I = themeRect(geo.inner, PEN_INNER);
      const gw = G.x1 - G.x0;
      const gh = G.y1 - G.y0;
      /* SVG 的坐标系仍然是「猪圈 0..100」（草簇/波浪的坐标不用改），
       * 靠「负偏移 + 放大」把它铺回猪圈原位；裁剪交给外层的 .pighub-grass-clip（overflow:hidden）。
       * 于是草坪只出现在用户红框里，草簇也不会溢出框外。 */
      const shot = {
        left: penRound((-G.x0 / gw) * 100) + '%',
        top: penRound((-G.y0 / gh) * 100) + '%',
        width: penRound((100 / gw) * 100) + '%',
        height: penRound((100 / gh) * 100) + '%',
      };
      return h('div', {
        className: 'pighub-grass-clip',
        style: {
          left: G.x0 + '%',
          top: G.y0 + '%',
          right: penRound(100 - G.x1) + '%',
          bottom: penRound(100 - G.y1) + '%',
        },
        'aria-hidden': true,
      },
        h('svg', {
          className: 'pighub-grass',
          style: shot,
          viewBox: '0 0 100 100',
          preserveAspectRatio: 'none',
          'aria-hidden': true,
        },
        h('rect', { key: 'out', className: 'pighub-field-out', x: 0, y: 0, width: 100, height: 100 }),
        h('rect', {
          key: 'base',
          className: 'pighub-field-base',
          x: I.x0,
          y: I.y0,
          width: penRound(I.x1 - I.x0),
          height: penRound(I.y1 - I.y0),
        }),
        h('path', {
          key: 'far',
          className: 'pighub-field-far',
          d: 'M0 0 H100 V21 C79 25.5 58 18 39 22.5 C25 26 11 20.5 0 24 Z',
        }),
        h('path', {
          key: 'near',
          className: 'pighub-field-near',
          d: 'M0 100 H100 V80 C79 84.5 59 76.5 38 81.5 C24 84.5 11 78.5 0 82.5 Z',
        }),
        h('path', {
          key: 'earth',
          className: 'pighub-field-earth',
          d: 'M 25 64 C 27 56 38 52 50 53 C 64 54 74 58 72 65 C 70 72 55 76 42 74 C 30 72 23 71 25 64 Z',
        }),
        h('g', { key: 'tufts' }, PEN_TUFTS.map((t, index) => h('path', {
          key: 'tuft' + index,
          className: 'pighub-tuft' + (t.light ? ' is-light' : ''),
          d: penTuftPath(t),
          strokeWidth: penRound(0.24 + t.s * 0.13),
          strokeLinecap: 'round',
          opacity: t.y < 45 ? 0.5 : 0.72,
        }))),
        ),
      );
    }

    /** 仓库小屋：正面亮、右侧暗（平涂两色）；落地靠接触影 + 偏右下投影两个平涂椭圆。 */
    function HouseArt() {
      return h('svg', { viewBox: '0 0 40 34', 'aria-hidden': true },
        h('ellipse', { key: 'cast', className: 'pighub-house-cast', cx: 23.4, cy: 30.2, rx: 13.6, ry: 1.9 }),
        h('path', { key: 'side', className: 'pighub-house-wall-sh', d: 'M32.6 14.4 L36.6 12.9 L36.6 27.4 L32.6 30 Z' }),
        h('rect', { key: 'wall', className: 'pighub-house-wall', x: 4.4, y: 14.4, width: 28.2, height: 15.6 }),
        h('path', { key: 'gable', className: 'pighub-house-wall', d: 'M4.4 14.6 L18.5 5.4 L32.6 14.6 Z' }),
        h('path', { key: 'roofL', className: 'pighub-house-roof', d: 'M1.4 13.6 L18.5 2.2 L18.5 5.4 L4.4 14.6 Z' }),
        h('path', { key: 'roofR', className: 'pighub-house-roof-sh', d: 'M18.5 2.2 L35.6 13.6 L32.6 14.6 L18.5 5.4 Z' }),
        h('rect', { key: 'plinth', className: 'pighub-house-plinth', x: 4.4, y: 28.2, width: 28.2, height: 1.8 }),
        h('path', { key: 'door', className: 'pighub-house-door', d: 'M14.8 30 V23.6 a3.7 3.7 0 0 1 7.4 0 V30 Z' }),
        h('rect', { key: 'win', className: 'pighub-house-window', x: 8.2, y: 18.4, width: 4.2, height: 4.2, rx: 0.6 }),
      );
    }
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
    /**
     * 这只猪允不允许自己走动。
     * 用户口径（2026-11-12）：「每只猪在右键本体和列表名单可以配置允许运动与否的行为」。
     * 所以 `motion` 是数据里的显式开关，缺省时回落到素材判定的默认行为（会动 / 静止），
     * 这样老状态文件与冻结库都不用迁移。
     */
    const pigCanMove = (pig) => (typeof pig.motion === 'boolean' ? pig.motion : pig.kind !== 'dead');

    /* ------------------------------------------------------------------ 游走模型
     * 用户口径（2026-11-13）：「猪圈和桌宠的行为以及大小完全一致，以桌宠行为为准」。
     * 所以这里的每个数都从桌宠那边抄，并且**指名道姓抄的是哪一行**（lib/native/pet-window.cs）：
     *
     *   决策间隔 1700ms     cs:230   pet.NextDecision = now + 1700;
     *   发呆概率 0.72       cs:232   if (Unity < 0.72)
     *   方向 均匀 0..2π     cs:233   double angle = Unity * Math.PI * 2;
     *   单步 1.65~3.0 身位  cs:234   pet.Size * (1.65f + 1.35f * (float)Unity)
     *   速度 1 身位/秒      cs:244   pet.Size * 1.0f * (33f / 1000f)（每 33ms 一帧，cs:101）
     *   朝向 dx > 0 为右    cs:248   pet.FacingRight = dx > 0;
     *   边界夹取不反弹      cs:249-251  每帧 clamp 到 WorkingArea
     *   走动时上下起伏      cs:266   hop = |sin| * pet.Size * 0.12
     *   松手原地站稳 6s     cs:397   dropped.NextDecision = ... + 6000;
     *   拖动中不走          cs:203/228/376  拖动的猪跳过 Step，且 Walking=false
     *
     * 「身位」换算：桌宠的 1 身位 = pet.Size（= pets.json 的 size = sizeRatio 的 CSS px，cs:176-178）；
     * 猪圈的 x/y 是**猪圈边长的百分比**（left/top: x%），所以 1 身位 = sizeRatio / 猪圈宽度 × 100 个百分点。
     */
    const DECISION_MS = 1700;        // cs:230
    const IDLE_CHANCE = 0.72;        // cs:232
    const PIG_PX = 96;               // 本体宽度（CSS px），两层共用（cs:176-178：size 由宿主以 CSS px 下发，原生乘 dpiScale）
    const WALK_PX_PER_S = PIG_PX;    // cs:244 的口径：96px 的猪每秒走 96px
    const SPEED_BODY_PER_S = WALK_PX_PER_S / PIG_PX;   // = 1.0 身位/秒；桌宠也按 Size 同比放大，所以与猪的大小无关
    const STEP_MIN_BODY = 1.65;      // cs:234 常数项
    const STEP_MAX_BODY = 3.0;       // cs:234 = 1.65 + 1.35（Unity < 1，故上限取不到 3.0）
    /* 一次决策最多走多远：桌宠在 1700ms 后**再决策一次**（cs:229-230），走路会被下一次决策打断，
     * 所以每一段实际位移 ≤ 速度 × 1.7s = 1.7 个身位。猪圈这边把这个截断做在**目标点**上：
     * 距离与时长仍成正比（恒速），但不会越过下一个决策点。
     * 依据：cs:230 重设 NextDecision 时 pet.Walking 可能仍为 true（只有发呆分支才置 false），
     * 也就是「走到一半被截住」是桌宠的真实行为，而不是我们的取舍。 */
    const STEP_CAP_BODY = SPEED_BODY_PER_S * (DECISION_MS / 1000);   // = 1.7
    /* 活动区（圆心可到的百分比范围）。它与 cs:249-251 的 WorkingArea 是同一个角色：矩形夹取，不是反弹。
     * 两边的差别只在夹的是谁——桌宠按**左上角**夹进屏幕工作区，猪圈按**圆心**夹进这块留白区。
     *
     * 数值 = 栅栏内圈（PEN_INNER）四边各收「半个猪身」：
     *   参考猪 96px 宽、256 只实测的中位高宽比 0.888 → 85px 高；
     *   451px 参考猪圈宽（本机实测）→ 半宽 96/2/451×100 = 10.64、半高 85/2/451×100 = 9.46。
     *   13.40+10.64 = 24.04，86.60−10.64 = 75.96，19.70+9.46 = 29.16，81.74−9.46 = 72.28。
     * 于是**猪的整只可见像素都落在栅栏内圈里**（不压木头、不出草坪——草坪红框比内圈还大）。
     * 已知边界：sizeRatio 上到 185px 的少数大猪，半宽 20.5 个百分点，仍会盖住内侧 10 个百分点的栏面；
     * 这是「一个常量夹取、与桌宠同一套规则」(cs:249-251) 的代价，不为了让几张大图好看去改运动模型。 */
    const PEN_BOX = { x0: 24.04, x1: 75.96, y0: 29.16, y1: 72.28 };

    /** 当前猪圈宽度（px）：把「身位」换算成百分比要用它。面板还没量到时用 451（本机实测值）兜底。 */
    function penWidthPx() {
      const rect = STORE.get().penRect;
      return rect && rect.width > 0 ? rect.width : 451;
    }

    /** 一个身位等于多少个百分点——cs:176-178 的 Size ↔ 猪圈百分比的换算，只有这一处。 */
    function penBodyPct(sizePx) {
      const size = Number(sizePx) > 0 ? Number(sizePx) : PIG_PX;
      return (size / penWidthPx()) * 100;
    }

    /**
     * 还没有 actor 状态时（数据刚到的那一帧）用的确定性种子。
     * 与 usePenActors 的网格摆放（22/26/30/18）同一套常量：否则首帧渲染与 effect 播种落在两个点上，
     * CSS 的 left/top 过渡会把猪从一处滑到另一处。
     */
    function penSeedSpot(pig, index) {
      if (pig && pig.pos && Number.isFinite(pig.pos.x) && Number.isFinite(pig.pos.y)) {
        return { x: pig.pos.x, y: pig.pos.y };
      }
      return { x: 22 + (index % 3) * 26, y: 30 + Math.floor(index / 3) * 18 };
    }

    /**
     * 这只猪渲染出来有多高（猪圈边长的百分比）。
     * actor 的宽是 sizeRatio（CSS px，素材体量归一化后的值），高由贴图自己的高宽比决定
     * （.pighub-actor img 是 width:100%;height:auto），高宽比随快照下发（pig.aspect = manifest 的 size.h / size.w）。
     * 猪圈是 1:1（aspect-ratio:1/1），所以「占宽的百分之几」与「占高的百分之几」是同一个数。
     */
    function penActorHeightPct(pig) {
      const width = pig && Number(pig.sizeRatio) > 0 ? Number(pig.sizeRatio) : PIG_PX;
      const aspect = pig && Number(pig.aspect) > 0 ? Number(pig.aspect) : 1;
      return penBodyPct(width) * aspect;
    }

    /**
     * 脚底在猪圈里的位置（高度的百分比）。
     * **不是 top**：actor 的 left/top 给的是**中心**（transform: translate(-50%,-50%)），
     * 而遮挡要比的是贴图的底边——库里的贴图是紧裁到猪身的，所以底边就是脚底。
     * 脚底 = 中心 y + 渲染高度 / 2。
     */
    function penFootPct(actor, pig) {
      const centerY = actor && Number.isFinite(Number(actor.y)) ? Number(actor.y) : 0;
      return centerY + penActorHeightPct(pig) / 2;
    }

    /**
     * 猪之间按**脚底**排序的 z-index 表（用户口径 2026-11-14：「猪猪之间用脚底位置判断遮挡关系，下遮挡上」）。
     * 返回 { [id]: z }，z ∈ [Z_ACTOR_MIN, Z_ACTOR_MAX] —— 即夹在小屋（2）与近栏（30）之间那一档。
     *
     * 为什么给**名次**而不是 z = f(脚底)：
     *   ① 名次是精确的。脚底差 0.1% 也排得出先后；把脚底换算成固定区间的整数会把这点差别抹平，
     *      两只贴得很近的猪就只能由 id 兜底，于是「下遮挡上」在某些对子上变成「id 遮挡上」。
     *   ② 一档只要放得下圈里的猪（容量 12，档宽 26）。用 f(脚底) 就得在 26 个整数里塞进 0..560px，
     *      大约每 20px 才分得开一次；名次只用 12 个槽。
     *   ③ 名次天然定义「同脚底」：第二关键字是 id（字符串比较），两只脚底完全相等时顺序由 id 决定，
     *      与这一帧的渲染次序无关 → 不会在两帧之间来回抢层（闪烁）。
     * 拖动中的猪**排在最后**（= 这一档最高的 z）：拖起来不能被别的猪挡住；它仍然低于近栏。
     * 每次渲染都重算这张表（游走一步、拖动、落地、回圈都会触发渲染），不是挂载时算一次。
     */
    function penZIndexMap(pigs, actors, draggingId) {
      const rows = (pigs || []).map((pig, index) => {
        const actor = (actors && actors[pig.id]) || penSeedSpot(pig, index);
        return { id: pig.id, foot: penFootPct(actor, pig) };
      });
      rows.sort((a, b) => {
        if (a.id === draggingId) return 1;
        if (b.id === draggingId) return -1;
        return (a.foot - b.foot) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
      });
      const map = {};
      rows.forEach((row, rank) => { map[row.id] = Math.min(Z_ACTOR_MAX, Z_ACTOR_MIN + rank); });
      return map;
    }

    /** 夹取（cs:249-251 的 Math.Max/Math.Min）。**不是反弹**：贴墙的猪继续朝墙走，但走不出去。 */
    function clampTo(value, lo, hi) {
      return Math.min(hi, Math.max(lo, value));
    }

    /** 朝向：cs:248「FacingRight = dx > 0」。相等时朝左＝素材默认朝向，所以只有 right 才镜像（CSS --pighub-dir=-1）。 */
    function facingFor(fromX, toX) {
      return toX > fromX ? 'right' : 'left';
    }

    /** 单步距离区间（百分点）：1.65~3.0 个身位（cs:234），另给出一次决策的位移上限（见 STEP_CAP_BODY）。 */
    function stepRangePct(sizePx) {
      const body = penBodyPct(sizePx);
      return { min: body * STEP_MIN_BODY, max: body * STEP_MAX_BODY, cap: body * STEP_CAP_BODY, body };
    }

    /**
     * 桌宠一次决策里「挑落脚点」的那两步（cs:233-234）：先掷方向，再掷步长。
     * 随机数的**个数与顺序与桌宠一致**（每次决策恰好两个；发呆那一个在 penDecide 里先掷），
     * 不再像旧实现那样「最多重掷 12 次角度 + 镜面反弹」——那会把方向分布压偏。
     * 越过边界的落点**夹取**回活动区（cs:249-251），不重掷、不反弹。
     * rand 可注入，只给测试与离线采样脚本用；运行时不传。
     */
    function penStep(from, sizePx, rand) {
      const r = typeof rand === 'function' ? rand : Math.random;
      const body = penBodyPct(sizePx);
      const angle = r() * Math.PI * 2;                                             // cs:233
      const stepBody = STEP_MIN_BODY + (STEP_MAX_BODY - STEP_MIN_BODY) * r();      // cs:234（身位）
      const walkBody = Math.min(stepBody, STEP_CAP_BODY);                          // cs:230+244：一窗走不完的部分截掉
      const walk = body * walkBody;                                                // 换成百分点
      return {
        x: clampTo(from.x + Math.cos(angle) * walk, PEN_BOX.x0, PEN_BOX.x1),
        y: clampTo(from.y + Math.sin(angle) * walk, PEN_BOX.y0, PEN_BOX.y1),
        // 诊断用：采样到的步长与真正要走的步长（身位）。离线采样脚本据此出分布，
        // 不必从被夹取过的落点反推；运行时只读 x / y。
        stepBody,
        walkBody,
      };
    }

    /**
     * 一次完整决策 = cs:232-247（发呆分支 + 挑落脚点 + 恒速走过去）：
     *   先掷发呆（0.72 原地不动）→ 否则挑落脚点 → 朝它匀速走完。
     * 返回 { walk:false } 或 { walk:true, x, y, dir, walkMs }。
     * walkMs = 距离 ÷ 1 身位/秒，与桌宠「每帧按 speed 逼近、到点即停」（cs:240-247）等价。
     */
    function penDecide(from, sizePx, rand) {
      const r = typeof rand === 'function' ? rand : Math.random;
      if (r() < IDLE_CHANCE) return { walk: false };        // cs:232
      const to = penStep(from, sizePx, r);                  // cs:233-234 + 249-251
      const body = penBodyPct(sizePx);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      return {
        walk: true,
        x: to.x,
        y: to.y,
        dir: facingFor(from.x, to.x),                       // cs:248
        walkMs: Math.max(0, Math.round((distance / body) / SPEED_BODY_PER_S * 1000)),
        stepBody: to.stepBody,                              // 采样到的步长（身位，仅供采样脚本与测试记账）
        walkBody: to.walkBody,                              // 截断后真正要走的步长（身位）
      };
    }

    /**
     * 下一次决策的时刻。桌宠是 `NextDecision = now + 1700`（cs:230）；
     * 猪圈的调度器 250ms 扫一次，若照抄 now+1700，节拍会被拖成 1700~1950ms（平均慢 6%）。
     * 所以从**上一次的到期点**顺延 1700（节拍照旧是 1700ms），只有掉队超过一整拍才从现在重起算
     * （后台标签页/系统睡眠回来时不补拍，避免连甩好几步）。
     */
    function nextDecisionAt(now, due) {
      const straight = due ? due + DECISION_MS : 0;
      return straight > now ? straight : now + DECISION_MS;
    }

    /** 走动后的落点回写（节流：同一步只报一次，避免每帧发请求）。 */
    let lastReportedPos = '';

    /** 松手后原地站稳的时长（用户口径：「松开手固定落点」，别一放就自己走了）。 */
    const SETTLE_MS = 6000;

    /*
     * 轮询节奏（2026-11-14，依据 archive/20261114-135230-pet-return-continuity）：
     *   WATCH_MS      —— tick 的粒度；
     *   IDLE_WATCH_MS —— 没有桌宠时的**令牌**间隔（只为尽快发现"有猪出门了"：出门后才会切到 250 ms）；
     *   FULL_POLL_MS  —— 整张快照的兜底间隔（位置这类不进令牌的变化靠它对账）。
     * 250 是实测挑的：桌宠消失实测 205±4 ms（stop 文件 → 原生窗口 33 ms 一帧 → Close），
     * 对账间隔比它略大，所以绝大多数情况下猪圈里画出来时桌面那只已经不在了（不出现"两个身子"），
     * 空窗从 8.36 s 压到 ≤300 ms。
     */
    const WATCH_MS = 250;
    const IDLE_WATCH_MS = 1000;
    const FULL_POLL_MS = 10000;



    /**
     * 两个落脚点是不是"同一个点"。容差 0.05 个百分点（本机 421.8px 的猪圈 ≈ 0.2px）：
     * 宿主落盘时会把 pos 四舍五入到两位小数（lib/store.js normalisePos），所以不能按字符串比。
     */
    function sameSpot(a, b) {
      return !!a && !!b && Number.isFinite(a.x) && Number.isFinite(b.x)
        && Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
    }

    function usePenActors(pigs, disabled, draggingId, returnedIds) {
      const [actors, setActors] = useState({});
      // 最近一次采纳过的「宿主记录位置」。用来区分"宿主改了位置"和"我们自己刚走过去"——
      // 只有前者才应该把猪搬过去，否则每写一次 pos 就会把正在走路的猪拽回去。
      const seenPos = useRef({});
      // 运动开关进签名：在右键菜单里把一只猪改成「保持静止」，要立刻停，而不是等下次抽猪。
      // 位置也进签名：宿主改了 pig.pos（换个窗口进来、或拖动落点写回）时要立刻采纳，
      // 不能等下一次 id/motion 变化。自己走出来的位置由 seenPos 挡住，不会来回弹。
      const signature = pigs.map((p) => p.id + ':' + (pigCanMove(p) ? '1' : '0')
        + ':' + (p.pos && Number.isFinite(p.pos.x) ? p.pos.x.toFixed(1) + ',' + p.pos.y.toFixed(1) : '-')).join('|')
        + '|drag:' + (draggingId || '')
        // 从桌面回来的猪要在签名里体现，否则 effect 不会为它重新播种。
        + '|back:' + ((returnedIds || []).join(','));
      const canMove = pigCanMove;
      useEffect(() => {
        let alive = true;
        setActors((prev) => {
          const next = {};
          pigs.forEach((pig, index) => {
            const old = prev[pig.id];
            // 有记过的落点就用记过的（用户口径：「不要每次进入都从原点移动」）；
            // 没记过的才按 3 列网格铺开——随机撒点会让头几只叠在一起，看着像一张图而不是一群猪。
            const remembered = pig.pos && Number.isFinite(pig.pos.x) && Number.isFinite(pig.pos.y) ? pig.pos : null;
            // 宿主给的位置变了（例如刚进门、或另一个窗口拖过这只猪）→ 采纳它。
            const seen = seenPos.current[pig.id];
            // 位置回退的元凶：宿主快照可能是旧的。只有「宿主记录的写入时间比我们最后一次写入更晚」才采纳，
            // 也就是另一处（另一个窗口/工具/拖拽）确实改过它。
            const hostAt = Number(pig.posAt) || 0;
            const sentAt = lastPosSent[pig.id] || 0;
            /*
             * 「宿主改了位置」必须同时满足三条（2026-11-14，依据 archive/drag-drop-origin.md）：
             *   ① 这一版位置**不是上次见到的那一版**——这个 effect 的签名里带着 drag 标志，
             *      拖动开始与松手各会让它重跑一次；只要重跑就算「宿主改过位置」，松手那一拍就会
             *      把 actor 平滑搬回拖动前的旧位置（实测反向 132px / 1.6s，用户口径：不许回溯）；
             *   ② 也**不是我们自己刚写下去的那一版**——宿主回传落点时 pos 就是我们自己写的，
             *      再"采纳"一次就是第二段位移（先回旧点、再滑回落点）；
             *   ③ 时间戳规则照旧：宿主带上更新更晚的 posAt 时才算外部改动。
             * 注意 ③ 在真机上形同虚设：快照里没有 posAt（normaliseState 不落它），hostAt 恒为 0。
             * 所以真正起作用的是 ①②——它们只看**值**，不依赖宿主回传时间戳。
             */
            const hostMoved = remembered
              && !sameSpot(seen, remembered)
              && !sameSpot(lastPosWritten[pig.id], remembered)
              && (hostAt === 0 || hostAt > sentAt);
            if (remembered) seenPos.current[pig.id] = { x: remembered.x, y: remembered.y };
            // 静止的猪也要**采纳宿主改的位置**（拖回猪圈落在松手处，靠的就是这条路）。
            // 2026-11-13 踩过：这段判断原来排在 !canMove 之后，静止猪永远接不到新落点。
            if (old && hostMoved) {
              // 别的窗口/工具改了位置：**平滑走过去**，不要直接赋值（直接赋值就是一次闪现）。
              const dist = Math.hypot(remembered.x - old.x, remembered.y - old.y);
              const speedPct = (pig.sizeRatio || PIG_PX) / penWidthPx() * 100;
              next[pig.id] = Object.assign({}, old, {
                x: remembered.x,
                y: remembered.y,
                mode: canMove(pig) ? 'walk' : 'static',
                dir: facingFor(old.x, remembered.x),
                walkMs: Math.max(0, Math.round((dist / speedPct) * 1000)),
                fresh: false,
                nextAt: Date.now() + DECISION_MS,
              });
              return;
            }
            // 不允许运动的猪：位置一旦定下就不再变，mode 固定为 static，CSS 也不给它任何动画。
            // （以前这里看 kind==='dead'；「活死」现在只是默认值，用户在右键菜单里可以逐只改。）
            if (!canMove(pig)) {
              next[pig.id] = old || {
                x: 20 + (index % 3) * 30,
                y: 32 + Math.floor(index / 3) * 22,
                mode: 'static',
                dir: 'left',
              };
              if (old) next[pig.id] = Object.assign({}, old, { mode: 'static' });
              return;
            }
            // 从桌面拖回来的猪：**接着走**，不重置节奏（goal 验收线 3「进出不重置计时与目标点」）。
            // 它已经有落脚点（松手处），所以不需要再"先站稳一拍"。
            if (!old && remembered && returnedIds && returnedIds.indexOf(pig.id) >= 0) {
              next[pig.id] = { x: remembered.x, y: remembered.y, mode: 'idle', dir: 'left', fresh: false, nextAt: Date.now() };
              return;
            }
            // fresh：刚摆好位置的那一帧不要马上走——用户口径「记录位置点进入就要在那里」。
            // 第一个 tick 先发呆，第二个 tick 才可能挪；否则"进门就在原地"只成立不到 1.7 秒。
            // 兜底站位用**确定性网格**（不带随机抖动）：首帧渲染与 effect 播种落同一个点，
            // 才不会出现"从中心滑到位置"的过渡。
            const gridSpot = {
              x: 22 + (index % 3) * 26,
              y: 30 + Math.floor(index / 3) * 18,
              mode: 'idle',
              dir: 'left',
              fresh: true,
              nextAt: Date.now() + DECISION_MS,
            };
            next[pig.id] = old || (remembered
              ? { x: remembered.x, y: remembered.y, mode: 'idle', dir: 'left', fresh: true, nextAt: Date.now() + DECISION_MS }
              : gridSpot);
            // 没记过位置的，**首次摆放**时记一笔：下次进来就在这个点，而不是重新随机。
            // 只在 !old 时写——否则每次渲染都会重复上报（effect 在测试台里每帧都跑）。
            if (!old && !remembered && next[pig.id]) {
              STORE.savePosition(pig.id, next[pig.id].x, next[pig.id].y);
            }
          });
          return next;
        });
        // 调度器每 250ms 扫一遍，但**每只猪有自己的 nextAt**：到点了才决定走不走。
        // 用户口径 2026-11-13：「等待时长随机，每只猪独立计时」——
        // 不再用一个全局 tick 让所有猪一起掷骰子（那样它们会同步挪动，像列队）。
        const timer = setInterval(() => {
          if (!alive) return;
          const now = Date.now();
          setActors((prev) => {
            const next = Object.assign({}, prev);
            for (const pig of pigs) {
              const current = next[pig.id] || { x: 50, y: 46, mode: 'idle', dir: 'left' };
              // 拖动中的猪不游走：手指按着它的时候，位置只能由指针决定。
              if (draggingId && draggingId === pig.id) { next[pig.id] = Object.assign({}, current, { mode: 'idle' }); continue; }
              // 刚落地的猪先站稳一会儿（SETTLE_MS），否则一松手就自己走开。
              if (current.holdUntil && now < current.holdUntil) { next[pig.id] = Object.assign({}, current, { mode: 'idle' }); continue; }
              if (!canMove(pig) || disabled) { next[pig.id] = Object.assign({}, current, { mode: 'static' }); continue; }
              // 还没轮到这只猪：什么都不做（保持当前姿态，避免每 250ms 重设 state）。
              if (current.nextAt && now < current.nextAt) continue;
              // 刚摆好的那一帧只发呆一次，然后把下一次决策时间推后。
              if (current.fresh) { next[pig.id] = Object.assign({}, current, { mode: 'idle', fresh: false, nextAt: now + DECISION_MS }); continue; }
              // 与桌宠一致：到点先掷一次骰子，72% 原地发呆；不发呆就挑落脚点匀速走过去。
              // 判断顺序、随机数的个数与顺序、朝向与时长全部收在 penDecide 里（逐行对应 cs:232-251）。
              const decision = penDecide(current, pig.sizeRatio || PIG_PX);
              const decisionAt = nextDecisionAt(now, current.nextAt);
              if (!decision.walk) { next[pig.id] = Object.assign({}, current, { mode: 'idle', nextAt: decisionAt }); continue; }
              // 自己走出来的位置也记进 seenPos：否则下一次快照回来会被判成"宿主改了位置"，把猪拽回去。
              seenPos.current[pig.id] = { x: decision.x, y: decision.y };
              // 朝向与时长由 penDecide 给出（cs:248 的 dx>0、cs:240-247 的恒速）。
              next[pig.id] = {
                x: decision.x, y: decision.y, mode: 'walk',
                dir: decision.dir,
                walkMs: decision.walkMs,
                nextAt: decisionAt,
              };
              // 落点写回宿主：下次打开面板时从这儿接着走，而不是从网格原点重新开始。
              // 落点取 penDecide 给出的 decision（此前误写成一个在本作用域不存在的 target，
              // 每只猪第一次真的要迈步就抛 ReferenceError，整块面板随之白屏）。
              const stamp = pig.id + ':' + decision.x.toFixed(1) + ':' + decision.y.toFixed(1);
              if (stamp !== lastReportedPos) {
                lastReportedPos = stamp;
                STORE.savePosition(pig.id, decision.x, decision.y);
              }
            }
            /* 一拍下来如果没有猪改变状态，就返回同一个引用——React 会跳过重渲染（卡顿的主因之一）。
             * 必须把 fresh / nextAt / holdUntil 也纳入比较：否则「发呆」这一拍的 nextAt 会被丢掉，
             * 猪会每 250ms 重新掷骰子，而且 fresh 永远清不掉——实测表现为**一只都不走**。 */
            let changed = false;
            for (const id of Object.keys(next)) {
              const a = prev[id];
              const b = next[id];
              if (!a || !b || a.x !== b.x || a.y !== b.y || a.mode !== b.mode || a.dir !== b.dir
                || a.fresh !== b.fresh || a.nextAt !== b.nextAt || a.holdUntil !== b.holdUntil) { changed = true; break; }
            }
            return changed ? next : prev;
          });
        }, 250);
        return () => { alive = false; clearInterval(timer); };
      }, [signature, disabled]);
      return { actors, setActors };
    }

    /* --------------------------------------------------------------- 猪圈面板 */
    function PigHubPanel() {
      const [state, setState] = useState(STORE.get());
      useEffect(() => STORE.subscribe(() => setState(STORE.get())), []);
      useEffect(() => { STORE.load(); }, []);

      // 右键菜单：{ pig, x, y }。位置用 clientX/clientY，菜单本身 position:fixed。
      const [pigMenu, setPigMenu] = useState(null);
      const openPigMenu = (event, pig) => setPigMenu({ pig, x: event.clientX, y: event.clientY });
      // 列表筛选：全部 / 猪圈 / 桌宠 / 库存（库存是用户要到的那一项）
      const [placeFilter, setPlaceFilter] = useState('all');
      // 原生桌宠不可用时只提示一次（别每次渲染都弹）。
      const nativeNoticeRef = useRef(false);

      const penRef = useRef(null);
      const houseRef = useRef(null);
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
      // 三态：pen 进场、pet 去桌面、store 进仓库（进仓库的不渲染，也就不加载贴图）
      const penPigs = pigs.filter((pig) => (pig.place || (pets.indexOf(pig.id) >= 0 ? 'pet' : 'pen')) === 'pen');
      const storeCount = pigs.filter((pig) => pig.place === 'store').length;
      // 列表筛选：只看某个位置的猪。'all' 显示全部，顺序仍按选中的排序走。
      const pigRows = placeFilter === 'all' ? pigs : pigs.filter((pig) => (pig.place || 'pen') === placeFilter);
      const today = (data && data.today) || { drawn: false, date: '' };
      const catalog = (data && data.catalog) || { count: 0, fetchedAt: '', error: '' };
      // 冻结素材库的只数：面板上「N 只猪猪可选」用的就是这个数（见 lib/assets.js 的 assetSummary）。
      const libraryCount = (data && data.assets && typeof data.assets.total === 'number') ? data.assets.total : 0;
      const draggingId = state.drag && state.drag.active ? state.drag.id : '';
      // 上一帧还在「桌宠」名单里、这一帧回到猪圈的 id —— 它们要接着走，不重置节奏。
      const prevPetsRef = useRef([]);
      const currentPets = (state.data && state.data.pets) || [];
      const penIds = penPigs.map((pig) => pig.id);
      const returnedIds = prevPetsRef.current.filter((id) => penIds.indexOf(id) >= 0 && currentPets.indexOf(id) < 0);
      useEffect(() => { prevPetsRef.current = currentPets; });
      const { actors, setActors } = usePenActors(penPigs, REDUCED, draggingId, returnedIds);

      // 桌宠落到了桌面上、但原生窗口跑不起来（非 Windows / 编译失败）→ 明确告诉用户在用页面浮层，
      // 而不是让他以为"拖出去了但看不见"。只提示一次。
      // 全局兜底：指针在猪身上之外松开（或系统取消）时也要结束拖动。
      // 否则那只猪会一直带着 is-hidden（看不见），而且再也拖不动——真机实测踩过。
      useEffect(() => {
        const finish = () => { if (STORE.get().drag) STORE.endDrag(); };
        if (typeof window === 'undefined' || !window.addEventListener) return undefined;
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        window.addEventListener('blur', finish);
        return () => {
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          window.removeEventListener('blur', finish);
        };
      }, []);

      useEffect(() => {
        const data = state.data;
        if (!data || nativeNoticeRef.current) return;
        const pets = data.pets || [];
        if (!pets.length) return;
        const native = data.desktopPet || {};
        if (native.supported === false) {
          nativeNoticeRef.current = true;
          STORE.toast('这台系统（' + (native.platform || '?') + '）没有原生桌宠，猪猪只能在页面里陪你');
        } else if (native.running === false) {
          nativeNoticeRef.current = true;
          STORE.toast('桌面桌宠没起来，暂时用页面内浮层代替');
        }
      }, [state.data]);

      // 把「拖到圈内松手」落到 actor 状态上：立刻摆到落点，并写回宿主。
      // 走 ref 注册而不是每次渲染重建，避免闭包拿到过期的 setActors。
      useEffect(() => {
        moveActorHandler = (pigId, x, y) => {
          setActors((prev) => Object.assign({}, prev, {
            [pigId]: Object.assign({}, prev[pigId] || { mode: 'idle', dir: 'left' },
              // holdUntil：松手后站在原地不动一段时间（SETTLE_MS，与桌宠 cs:397 的 6000 同值），
              // 再考虑继续游走。
              //
              // **不许再叠 fresh**（2026-11-14）：fresh 的语义是「刚摆好的那一帧先发呆一次」，
              // 它自己会再推后一个 DECISION_MS。两个一起设，落地后要等
              // 6 s（holdUntil）+ 1.7 s（fresh 那一拍）+ 0~1.7 s（第一次决策仍可能掷到原地发呆），
              // 实测体感就是「拖动落地后猪僵在那儿」（用户 2026-11-14 追加反馈）。
              // 落地只需要 holdUntil 一个计时器，fresh 是重复计数。
              //
              // walkMs: 0 = **把在飞的位移过渡一起取消**（用户口径 2026-11-14：「落地在哪，
              // 就把游走位置起点改成哪，不许有任何回头/回溯的位移」）。idle 本来就给 0ms，
              // 这里显式清掉上一步的时长，免得落地后任何一次 walk 沿用它滑一段。
              // 落点同时成为位置基准：savePosition 会把这一版记进 lastPosWritten，
              // 快照回传落点时（值相同）不会再被当成"外部改动"搬一次。
              { x, y, mode: 'idle', fresh: false, walkMs: 0, holdUntil: Date.now() + SETTLE_MS }),
          }));
          STORE.savePosition(pigId, x, y);
        };
        return () => { moveActorHandler = null; };
      }, [setActors]);

      // 素材：列表与人物的图都换成本地抠完白底的版本（同一份缓存，不重复处理）
      const imageMap = usePigImages(pigs);

      /*
       * 抽卡演出：**弹出 → 飞到窗口中心 → 停留 2.5 秒（卡片：名字 + 描述）→ 飞回猪圈落位**。
       * 四条设计约束（2026-11-14）：
       *   1. 起点是**按钮**（你按下的那个），不是屏幕中央 —— 动画要有因果感；
       *   2. 中心是**真实窗口中心**（window.innerWidth/2, window.innerHeight/2），不是猪圈中心
       *      （猪圈在面板右半边，拿它的矩形当中心一定是歪的）；
       *   3. 落点取这只猪此刻**真实的 DOM 中心**（不是百分比推算，实测差 18px）；
       *   4. 演出期间**不拦任何交互**：浮层 pointer-events:none，跳过靠 document 上的 pointerdown
       *      （捕获阶段但不阻止传播），所以点任意处立刻收场，而按钮/猪/列表照常可点。
       * 动画期间真正的猪先隐藏（is-hidden），落定后再出现 ——「看到它落在哪」与「它就在哪」是同一件事。
       */
      const [reveal, setReveal] = useState(null);
      const drawButtonRef = useRef(null);
      const revealTimers = useRef([]);
      const clearRevealTimers = () => {
        const list = revealTimers.current || [];
        for (const timer of list) clearTimeout(timer);
        revealTimers.current = [];
      };
      const laterReveal = (fn, ms) => { revealTimers.current.push(setTimeout(fn, ms)); };
      /** 收场（自然结束或用户点一下跳过）：清掉后续定时器，界面立刻复原。 */
      const endReveal = () => {
        clearRevealTimers();
        setReveal((current) => (current ? null : current));
      };
      // 组件卸载时别把定时器留在后台（面板切走 / 热重载都会走到这里）。
      useEffect(() => () => clearRevealTimers(), []);
      /* 跳过：document 捕获阶段的 pointerdown，**不 stopPropagation、不 preventDefault**——
       * 这一下点击照常作用在它真正落在的元素上（按钮照按、猪照拖），只是演出立刻收场。 */
      useEffect(() => {
        if (!reveal) return undefined;
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
        const skip = () => endReveal();
        document.addEventListener('pointerdown', skip, true);
        return () => {
          if (typeof document.removeEventListener === 'function') document.removeEventListener('pointerdown', skip, true);
        };
      }, [reveal ? reveal.id : null]);

      const startReveal = (pigId) => {
        clearRevealTimers();
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
        // 先给原图（抠底结果可能还在路上），避免弹出瞬间是空框；名字与描述也在这时取好。
        const store = STORE.get();
        const data = store && store.data ? store.data : {};
        const drawn = Array.isArray(data.pigs) ? data.pigs.filter((pig) => pig.id === pigId)[0] : null;
        const pooled = Array.isArray(data.pool) ? data.pool.filter((pig) => pig.id === pigId)[0] : null;
        const card = {
          title: (drawn && drawn.title) || (pooled && pooled.title) || ('猪猪 ' + pigId),
          desc: describePig(drawn) || describePig(pooled),
        };
        // 窗口中心：真实视口尺寸（面板、猪圈都在这个视口里），不是猪圈矩形。
        const winW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
        const winH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
        const center = { x: winW / 2, y: winH / 2 };
        const base = { id: pigId, from, center, target: null, sparks, imageUrl: drawn ? drawn.imageUrl : '', card };

        // 减少动画偏好：**不飞**，直接把卡片摆到中心停留 HOLD_MS（猪圈里那只也不隐藏）。
        if (prefersReducedMotion()) {
          setReveal(Object.assign({}, base, { phase: 'hold', reduced: true, sparks: [] }));
          laterReveal(() => setReveal((current) => (current && current.id === pigId ? null : current)), HOLD_MS);
          return;
        }

        setReveal(Object.assign({}, base, { phase: 'pop' }));

        // 起飞前再算落点：这时新猪的落脚点已经分配好了。
        laterReveal(() => {
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

        // 到中心即进入停留：卡片在这时亮出来（CSS is-hold 淡入），停满 HOLD_MS 再飞回去、卡片淡出。
        laterReveal(() => {
          setReveal((current) => (current && current.id === pigId ? Object.assign({}, current, { phase: 'hold' }) : current));
        }, POP_MS + FLY_MS);
        laterReveal(() => {
          setReveal((current) => (current && current.id === pigId ? Object.assign({}, current, { phase: 'back' }) : current));
        }, POP_MS + FLY_MS + HOLD_MS);
        // 回归的那一段飞行结束后才撤层：落定那一刻「它就在猪圈里」。
        laterReveal(() => {
          setReveal((current) => (current && current.id === pigId ? null : current));
        }, POP_MS + FLY_MS + HOLD_MS + FLY_MS + REVEAL_TAIL_MS);
      };
      /* 会动的猪被点一下会「弹」一下：加一个 600ms 的 class，CSS 用 squash & stretch 播放。
       * 用 class + 定时器而不是 Web Animations：动画结束撤掉 class 就完全复原，
       * 元素上不会留下一段隐式动画状态。静止的猪不响应点击（它不动）。 */
      const [squished, setSquished] = useState([]);
      const squish = (id) => {
        setSquished((list) => (list.indexOf(id) >= 0 ? list : list.concat(id)));
        setTimeout(() => setSquished((list) => list.filter((item) => item !== id)), 600);
      };
      const starMode = (data && data.prefs && data.prefs.starDisplay) || 'hover';
      /* 当前主题（快照里的 activeTheme 已在宿主侧回落过 classic）：
       * 设置浮层要画选择器、猪圈的栅栏与草地要吃几何，所以在这里定义一次、全文共用。
       * 注意必须在使用之前——设置浮层比 poolAll 那段构造得更早，放后面会踩 const 的 TDZ。 */
      const activeTheme = (data && data.activeTheme) || { name: 'classic' };

      /* 设置浮层。星级显示三档改的是 prefs，落盘在 Host 半，所以刷新/换机器后仍然生效。 */
      const [settingsOpen, setSettingsOpen] = useState(false);
      /** 图鉴：列出池子全部猪猪，未获取的压暗 + 名字打码（用户口径 2026-11-13）。 */
      const [galleryOpen, setGalleryOpen] = useState(false);
      /*
       * hover 档：划过就记一个「到期时间」，面板每 400ms 重渲染一次来让胶囊自己消失。
       * 用「到期时间 + 轮询」而不是「每只猪一个 setTimeout」：猪的数量是运行期才知道的，
       * 定时器数量不该随之增长；一次 400ms 的重渲染也就几毫秒。
       */
      const hoverRef = useRef({});
      const [, setHoverTick] = useState(0);
      useEffect(() => {
        // 只有「有胶囊正好到期」时才需要重渲染一次（早先每 400ms 无条件刷新，是卡顿的另一半）。
        const timer = setInterval(() => {
          const now = Date.now();
          const due = Object.keys(hoverRef.current).some((id) => {
            const deadline = hoverRef.current[id];
            return deadline && deadline <= now && deadline > now - 600;
          });
          if (due) setHoverTick((value) => value + 1);
        }, 400);
        return () => clearInterval(timer);
      }, []);
      const markHover = (id) => { hoverRef.current[id] = Date.now() + 5000; setHoverTick((value) => value + 1); };
      const isHoverLive = (id) => (hoverRef.current[id] || 0) > Date.now();

      const onPenPointerDown = useCallback((event, pig) => {
        if (event.button !== undefined && event.button !== 0) return;
        // 拖动优先于一切：先掐掉浏览器的默认行为（原生图片拖拽、文本选区、焦点转移）。
        // 不 preventDefault 的话，指针从猪身上划过文字就开始选，看起来像"拖动把页面选中了"。
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针捕获不可用就退化为普通拖拽 */ }
        }
        // 拖动影子的尺寸 = 这只猪本体尺寸（sizeRatio，与桌宠一致）。
        const size = pig.sizeRatio || PIG_PX;
        STORE.beginDrag({ id: pig.id, imageUrl: pig.imageUrl, title: pig.title, size, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false });
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
        // 落点优先级：仓库小屋 > 猪圈内（取消）> 圈外（变桌宠）
        const house = houseRef.current && typeof houseRef.current.getBoundingClientRect === 'function'
          ? houseRef.current.getBoundingClientRect()
          : null;
        const overHouse = house && house.width > 0
          && event.clientX >= house.left && event.clientX <= house.right
          && event.clientY >= house.top && event.clientY <= house.bottom;
        if (overHouse) {
          STORE.place(pig.id, 'store');
          STORE.toast('「' + (pig.title || '猪猪') + '」收进仓库了');
          return;
        }
        const inside = rect
          && event.clientX >= rect.left && event.clientX <= rect.left + rect.width
          && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
        if (inside) {
          // 用户口径（2026-11-13）：「猪圈拖动也要换位置」——
          // 在圈里松手不再算「取消」，而是把这只猪的落脚点改成松手处（并按百分比写回宿主）。
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          const clampedX = Math.min(90, Math.max(10, x));
          const clampedY = Math.min(88, Math.max(16, y));
          STORE.moveActorTo(pig.id, clampedX, clampedY);
          return;
        }
        // 拖出来 = 在**松手的位置**变成桌宠（用户口径：「拖出猪圈松手时也要桌宠落地松手位置」）
        // 原生窗口用的是**物理像素**，而指针事件给的是 CSS px，所以要乘 DPR（本机 2 倍）。
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // 原生窗口的 (x,y) 是**左上角**，而指针停在猪身上时语义是"中心"——所以减掉半个身位，
        // 这样松手时猪的中心正好落在指针处（用户口径：落点=松手点）。
        const w = (pig.sizeRatio || 96) * dpr;
        const h = w * (pig.aspect || 1);
        const dropX = Math.round(event.clientX * dpr - w / 2);
        const dropY = Math.round(event.clientY * dpr - h / 2);
        STORE.seedPet(pig.id, dropX, dropY);
        // 原生桌宠的初始坐标也在宿主那边决定，所以落点必须一起上报（否则它从上次的 desktopPos 冒出来）。
        STORE.setDesktopPos(pig.id, dropX, dropY);
        STORE.place(pig.id, 'pet');
        STORE.toast('「' + (pig.title || '猪猪') + '」出门遛弯了，双击可叫回猪圈');
      }, []);

      /* 设置按钮固定在**整个面板的右上角**（不是右栏的右上角）：它是这个页面的设置，
       * 与右栏内容滚动无关，所以用绝对定位挂在面板容器上。 */
      const galleryButton = h('button', {
        type: 'button',
        className: 'pighub-ghostbtn',
        title: '图鉴：看看池子里都有哪些猪猪',
        'aria-label': '图鉴',
        'aria-expanded': galleryOpen ? 'true' : 'false',
        onClick: () => setGalleryOpen((open) => !open),
        style: { marginRight: '6px', fontSize: '12px', padding: '0 8px', width: 'auto' },
      }, '图鉴');

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
        galleryButton,
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
              /* 猪圈主题（用户口径 2026-11-14）：列出快照里的 themes（内置 classic 永远第一 + ~/.PigHub/themes 下的目录），
               * 点一下走 {action:'theme'}，宿主落 prefs；rev 令牌带 theme，所以切换后立刻重取快照、不用重载插件。 */
              h('h4', null, '猪圈主题'),
              h('div', { className: 'pighub-seg' },
                ((data && data.themes) || [{ name: 'classic', title: 'classic（默认）' }]).map((item) =>
                  h('button', {
                    key: 'theme-' + item.name,
                    type: 'button',
                    'aria-pressed': activeTheme.name === item.name ? 'true' : 'false',
                    title: item.title || item.name,
                    onClick: () => { request({ action: 'theme', name: item.name }).then(apply).catch(() => {}); },
                  }, item.title || item.name),
                ),
              ),
              /* 「更换主题包」：用隐藏的 <input type=file accept=.zip> 唤起系统文件选择器（Electron 里就是原生对话框），
               * 选中的 zip 原样 POST 到 /pighub/theme-import；宿主校验并解压后**自动切到新主题**，这里只负责刷新快照。 */
              h('div', { className: 'row' },
                h('span', null, '主题包放在 ' + ((data && data.root) || '~/.PigHub') + '\\themes 下，或从 zip 导入'),
              ),
              h('label', { className: 'pighub-ghostbtn', style: { display: 'inline-block', marginTop: '6px', cursor: 'pointer' } },
                '更换主题包（.zip）…',
                h('input', {
                  type: 'file',
                  accept: '.zip,application/zip',
                  style: { display: 'none' },
                  onChange: (event) => {
                    const input = event && event.target;
                    const file = input && input.files && input.files[0];
                    if (!file) return;
                    const finish = () => { if (input) input.value = ''; };
                    // 走状态路由上的 action（不走单独的 /theme-import：宿主的 exact 路由按前缀先命中，
                    // 二进制会被状态路由当 JSON 解析）。base64 多 33%，但一定命中。
                    file.arrayBuffer()
                      .then((buffer) => {
                        let binary = '';
                        const bytes = new Uint8Array(buffer);
                        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
                        return fetch(ROUTE, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ action: 'theme-import', zipBase64: btoa(binary) }),
                        });
                      })
                      .then((response) => response.json())
                      .then((payload) => { if (payload && payload.ok) apply(payload); })
                      .catch(() => {})
                      .then(finish);
                  },
                }),
              ),
              // 客户端版本号：面板里能看到，用来确认浏览器半真的换上了新 bundle。
              h('div', { className: 'row' }, h('span', null, '插件版本：v' + ((data && data.version) || '?'))),
              h('h4', null, '素材库（本版本冻结）'),
              h('div', { className: 'row' },
                h('span', null, (data && data.assets && data.assets.version ? data.assets.version : '—')
                  // 用户口径 2026-11-13：「素材库猪数量显示也不区分活死猪」——
                  // 只报总数；「会不会动」是逐只的行为开关，不在这里暴露分类。
                  + ' · 共 ' + ((data && data.assets && data.assets.total) || 0) + ' 只'),
              ),
              h('h4', null, '数据目录'),
              h('div', { className: 'pighub-path' }, (data && data.root) || ''),
            )
          : null,
      );

      /* 抽取动画层：固定定位，坐标即视口坐标（面板没有 transform 祖先）。 */
      const landOffset = REVEAL_SIZE / 2;   // scale/rotate 都绕中心，因此中心 = translate + 半个元素尺寸
      /* 三个阶段三种落点：弹出在按钮、中心阶段（fly/hold）在**窗口中心**、回归在猪圈落点。
       * 缩放也在这里给：中心 1.8 倍（看得清名字与描述），回归 0.56 倍（与猪圈里的本体同尺寸）。 */
      const revealStage = (r) => {
        if (r.phase === 'pop') return { x: r.from.x, y: r.from.y, scale: 1 };
        if (r.phase === 'back' && r.target) return { x: r.target.x, y: r.target.y, scale: REVEAL_LAND_SCALE };
        return { x: r.center.x, y: r.center.y, scale: REVEAL_CENTER_SCALE };
      };
      /* 卡片在猪**上方**：猪放大后有一半高度，卡片底边压在它头顶 12px 处，不遮挡猪。
       * 再夹一个 76px 的下限，窄窗口里卡片也不会顶出视口。 */
      const revealCardTop = (r) => Math.max(76, r.center.y - (REVEAL_SIZE * REVEAL_CENTER_SCALE) / 2 - 12);
      const revealLayer = reveal
        ? h('div', null,
            reveal.phase === 'pop' && !reveal.reduced
              ? reveal.sparks.map((spark) => h('span', {
                  key: 'spark-' + spark.id,
                  className: 'pighub-spark',
                  style: {
                    '--sx': spark.sx + 'px', '--sy': spark.sy + 'px',
                    '--ex': spark.ex + 'px', '--ey': spark.ey + 'px',
                  },
                }))
              : null,
            // 减少动画偏好：不做飞行，这一层整个不画，只留卡片。
            reveal.reduced
              ? null
              : h('div', {
                  className: 'pighub-reveal ' + (reveal.phase === 'pop' ? 'is-pop' : 'is-fly'),
                  style: {
                    width: REVEAL_SIZE + 'px',
                    height: REVEAL_SIZE + 'px',
                    transform: (() => {
                      const at = revealStage(reveal);
                      const move = 'translate3d(' + (at.x - landOffset) + 'px,' + (at.y - landOffset) + 'px,0)';
                      // 弹出阶段交给 CSS 关键帧（它自己从 .15 弹到 1），不再叠一个 scale。
                      // 回归也不转圈：落地那一刻猪是**正着的**（旋转中的定格看起来像翻车）。
                      return reveal.phase === 'pop' ? move : move + ' scale(' + at.scale + ')';
                    })(),
                  },
                },
                  h('img', {
                    src: imageMap[reveal.id] || reveal.imageUrl || '',
                    alt: '',
                    draggable: false,
                    referrerPolicy: 'no-referrer',
                  }),
                ),
            // 名字 + 描述：停留期亮出来，回归开始即淡出（is-hold 撤掉 → CSS 透明度回 0）。
            reveal.phase === 'hold' || reveal.phase === 'back'
              ? h('div', {
                  className: 'pighub-reveal-card' + (reveal.phase === 'hold' ? ' is-hold' : ''),
                  style: { left: reveal.center.x + 'px', top: revealCardTop(reveal) + 'px' },
                },
                  h('div', { className: 'pighub-reveal-name' }, reveal.card.title),
                  reveal.card.desc ? h('div', { className: 'pighub-reveal-desc' }, reveal.card.desc) : null,
                )
              : null,
          )
        : null;

      // 右键菜单：本体与列表行共用。只有「运动开关」两项——它改的是行为，不是位置；
      // 位置三态有自己的手势（拖出圈=桌宠、拖进小屋=库存、点库存行=放出）。
      const pigMenuLayer = pigMenu
        ? [
            h('div', { key: 'backdrop', className: 'pighub-backdrop', onClick: () => setPigMenu(null) }),
            h('div', {
              key: 'menu',
              className: 'pighub-menu',
              style: {
                left: Math.max(8, Math.min(pigMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 180)),
                top: Math.max(8, Math.min(pigMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 130)),
              },
            },
              h('div', { className: 'pighub-menu-title' }, (pigMenu.pig.title || ('猪猪 ' + pigMenu.pig.id)) + ' · 行为'),
              h('button', {
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': pigMenu.pig.motion !== false ? 'true' : 'false',
                onClick: () => { STORE.setMotion(pigMenu.pig.id, true); setPigMenu(null); },
              }, '允许运动'),
              h('button', {
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': pigMenu.pig.motion === false ? 'true' : 'false',
                onClick: () => { STORE.setMotion(pigMenu.pig.id, false); setPigMenu(null); },
              }, '保持静止'),
            ),
          ]
        : null;

      /* 图鉴：池子里每一只都列出来；没拿到的是暗色剪影 + 「？？？」。 */
      const ownedIds = {};
      for (const pig of (data && data.pigs) || []) ownedIds[pig.id] = pig;
      /* 当前主题（快照里的 activeTheme 已在宿主侧回落过 classic）：养在这里，供栅栏/草地/小屋共用。 */
      const theme = activeTheme;
      // 已获取的排前面（否则 256 格里很难找到自己的猪），未获取的保持原序
      const poolAll = (data && data.pool) || [];
      const pool = poolAll
        .filter((pig) => ownedIds[pig.id])
        .concat(poolAll.filter((pig) => !ownedIds[pig.id]));
      const gallery = galleryOpen
        ? h('div', { className: 'pighub-gallery' },
            h('div', { className: 'pighub-gallery-head' },
              h('strong', null, '图鉴 ' + pool.length + ' 只 · 已收集 ' + Object.keys(ownedIds).length + ' 只'),
              h('button', { type: 'button', className: 'pighub-ghostbtn', onClick: () => setGalleryOpen(false) }, '关闭'),
            ),
            h('div', { className: 'pighub-gallery-grid' },
              pool.map((pig) => {
                const owned = ownedIds[pig.id];
                return h('div', {
                  key: pig.id,
                  className: 'pighub-gallery-cell' + (owned ? '' : ' is-locked'),
                  title: owned ? (owned.title || pig.title || '猪猪') : '尚未获取',
                },
                  h('img', { src: pig.url, alt: owned ? (owned.title || '猪猪') : '未获取', draggable: false, referrerPolicy: 'no-referrer' }),
                  h('span', { className: 'pighub-gallery-name' }, owned ? (owned.title || pig.title || '猪猪') : '？？？'),
                  owned && owned.stars
                    ? h('span', { className: 'pighub-gallery-stars' }, '★'.repeat(Math.max(1, Math.min(3, owned.stars))))
                    : null,
                );
              }),
            ),
          )
        : null;

      /* 这一帧的 z 名次表：按脚底排（拖动中的那只排最后 = 一档里最上）。
       * 必须在 return 之前算，因为名次是**整圈相对**的，不是单只猪的函数；
       * 每帧重渲染都会重算（游走、拖动、落地、回圈都触发渲染）。 */
      const zById = penZIndexMap(penPigs, actors, state.drag && state.drag.active ? state.drag.id : null);

      return h('div', { className: 'pighub-panel' },
        settings,
        gallery,
        pigMenuLayer,
        revealLayer,
        h('div', { className: 'pighub-left' },
          h('div', { className: 'pighub-pen', ref: penRef },
            h(Meadow, { theme }),
            // 远侧栅栏（顶横梁 + 上角草石 + 侧栏上半）：画在猪的后面（z1）
            h(PenFence, { key: 'fence-back', theme }),
            h('div', { className: 'pighub-house', ref: houseRef, title: '把小猪拖进来收进仓库（不再加载）' },
              h(HouseArt, null),
            ),
            penPigs.length === 0
              ? h('div', { className: 'pighub-empty' }, state.phase === 'loading' ? '正在打开猪圈…' : '猪圈还是空的\n点右边的「今日猪猪」领一只')
              : penPigs.map((pig, index) => {
                  // 还没有 actor 状态时（数据刚到的那一帧），用与 effect 相同的确定性种子，
                  // 而不是 {x:50,y:46}——否则 CSS 的 left/top 过渡会把猪从中心滑到位置。
                  // 常量只在 penSeedSpot 里写一份（z 名次表也要用同一个种子，否则两处会差一格）。
                  const seed = penSeedSpot(pig, index);
                  /* 只有一个真相：actor 状态。宿主 pos 只用来**播种**（没有 actor 的那一帧）和触发
                   * 「平滑走过去」，绝不能在渲染时直接覆盖——那会让猪跳回去（闪现）。
                   * 2026-11-13 试过用宿主 pos 兜底，结果每 10 秒轮询就把正在走的猪拽回旧点。 */
                  const actor = actors[pig.id] || { x: seed.x, y: seed.y, mode: 'idle' };
                  const motionClass = actor.mode === 'static' ? 'is-static' : (actor.mode === 'walk' ? 'is-walk' : 'is-idle');
                  // 不允许运动的猪不挂点击：它「只能由用户拖动」，点击这件事对它不存在。
                  // 判定看 pig.motion（用户在右键菜单里逐只配置），不再看 kind。
                  const clickProps = pigCanMove(pig) ? { onClick: () => squish(pig.id) } : {};
                  return h('div', {
                    key: pig.id,
                    'data-pig': pig.id,
                    className: 'pighub-actor ' + motionClass
                      + (squished.indexOf(pig.id) >= 0 ? ' is-squish' : '')
                      // 减少动画偏好下不隐藏猪圈里那只：演出只画卡片，猪一直在圈里。
                      + (reveal && !reveal.reduced && reveal.id === pig.id ? ' is-hidden' : '')
                      // 用户口径（2026-11-13）：「拖动要能自由拖动，而不是拖起来原地还有一个」——
                      // 拖动中把本体藏起来，页面上只剩跟着指针的那一只（桌宠层画的拖动层）。
                      + (state.drag && state.drag.id === pig.id && state.drag.active ? ' is-hidden' : ''),
                    // 朝运动方向：素材默认朝左，向右走时镜像（--pighub-dir=-1）。
                    style: {
                      left: actor.x + '%',
                      top: actor.y + '%',
                      // 猪之间的遮挡：脚底越靠下（屏幕 y 越大）越靠前。值来自这一帧的 zById 名次表，
                      // 夹在 Z_ACTOR_MIN..Z_ACTOR_MAX 之间（= 小屋之上、近栏之下），见 penZIndexMap。
                      zIndex: zById[pig.id] || Z_ACTOR_MIN,
                      // 视觉体量归一化：每只猪按自己的 sizeRatio 定宽（中位数 96px）。
                      width: (pig.sizeRatio || 96) + 'px',
                      // 恒速：transition 时长 = 这一步的距离 / 速度（桌宠那边就是每帧按速度逼近）。
                      // walkMs 由「距离 ÷ 1 身位/秒」算出，被边界夹住时可能正好是 0（贴墙压步），
                      // 所以不能写 `|| 900`：那会把 0 变成一个假的 900ms。
                      transitionDuration: actor.mode === 'walk' ? ((actor.walkMs == null ? 900 : actor.walkMs) + 'ms') : '0ms',
                      '--pighub-dir': actor.dir === 'right' ? -1 : 1,
                    },
                    onPointerEnter: () => markHover(pig.id),
                    onContextMenu: (event) => {
                      event.preventDefault();
                      openPigMenu(event, pig);
                    },
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
                      title: (pig.title || '猪猪') + ' · ' + (pigCanMove(pig) ? '会自己走动' : '保持静止')
                        + ' · ' + starText(pig.stars) + ' · 按住拖出猪圈可当桌宠 · 右键可改运动',

                    }),
                  );
                }),
            // 近侧栅栏（底横梁 + 下角草石 + 侧栏下半）：最后画 → 压在猪身上（z4），
            // 走到底边的猪被挡住一截，这就是「景深」。
            h(PenFence, { key: 'fence-front', front: true, theme }),
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
              // 抽池是**冻结素材库**（data.assets），不是下一版候选池（catalog）。
              // 早期版本这里印的是 catalog.count：真实安装里候选池为空，于是面板写着
              // 「0 只猪猪可选」，而按「今日猪猪」明明能抽出猪——现在改成素材库口径，
              // 候选池只在真的有数时才附在后面。
              libraryCount + ' 只猪猪可选 · 已收集 ' + pigs.length + ' 只 · 抽过 ' + ((data && data.draws) || 0) + ' 次'
              + ' · 猪圈 ' + penPigs.length + ' 只 · 桌宠 ' + pets.length + ' 只'
              + (catalog.count ? ' · 候选池 ' + catalog.count + ' 只' : '')
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
          h('div', { className: 'pighub-filters', role: 'group', 'aria-label': '按位置筛选' },
            [['all', '全部'], ['pen', '猪圈'], ['pet', '桌宠'], ['store', '库存']].map(([key, label]) =>
              h('button', {
                key,
                type: 'button',
                className: 'pighub-filter',
                'aria-pressed': placeFilter === key ? 'true' : 'false',
                onClick: () => setPlaceFilter(key),
              }, label + (key === 'store' ? ' ' + storeCount : '')),
            ),
          ),
          h('div', { className: 'pighub-list' },
            pigRows.length === 0
              ? h('div', { className: 'pighub-meta' },
                  pigs.length === 0
                    ? '还没有猪猪。今日猪猪每天一次，慢慢喂。'
                    : '这个筛选下没有猪猪（' + (placeFilter === 'store' ? '库存是空的' : '换个筛选看看') + '）。')
              : pigRows.map((pig) => h('div', {
                  className: 'pighub-row' + (pig.place === 'store' ? ' is-store' : ''),
                  key: pig.id,
                  // 库存里的猪：点一下就放回猪圈（猪圈满 12 只时宿主会自动改放仓库并提示）。
                  onClick: pig.place === 'store' ? () => STORE.place(pig.id, 'pen') : undefined,
                  onContextMenu: (event) => { event.preventDefault(); openPigMenu(event, pig); },
                  title: pig.place === 'store' ? '点击放出到猪圈 · 右键改运动' : '右键可改运动',
                },
                  pigImage(pig, imageMap[pig.id]),
                  h('div', { className: 'pighub-row-main' },
                    h('div', { className: 'pighub-row-title' }, pig.title || ('猪猪 ' + pig.id)),
                    h('div', { className: 'pighub-row-sub' },
                      '首次获得 ' + shortTime(pig.firstObtainedAt) + ' · 最近升星 ' + shortTime(pig.lastUpgradedAt),
                    ),
                  ),
                  // 列表不标活死（用户口径）：「会不会动」是行为开关，不是身份。
                  pig.place === 'store' ? h('span', { className: 'pighub-tag', title: '在仓库里，点击放出到猪圈' }, '库存') : null,
                  pig.place === 'pet' ? h('span', { className: 'pighub-tag', title: '这只猪在猪圈外，正作为桌宠待着' }, '桌宠') : null,
                  pigCanMove(pig) ? null : h('span', { className: 'pighub-tag', title: '保持静止：不会自己走动（右键可改）' }, '静止'),
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
    /** 面板兜底：渲染抛错时显示可读错误，而不是白板（2026-11-13 用户报「入口完全空白」）。 */
    function PigHubPanelSafe(props) {
      try {
        return PigHubPanel(props || {});
      } catch (error) {
        return h('div', {
          style: { padding: '18px 20px', font: '13px/1.6 ui-monospace,Consolas,monospace',
            color: '#ffd6d6', background: '#2a1416', borderRadius: '10px', whiteSpace: 'pre-wrap' },
        }, 'PigHub 面板渲染出错：\n\n' + String((error && (error.stack || error.message)) || error));
      }
    }

    function PigHubPetLayer() {
      const [state, setState] = useState(STORE.get());
      useEffect(() => STORE.subscribe(() => setState(STORE.get())), []);
      useEffect(() => { if (!STORE.get().data) STORE.load(); }, []);
      // 面板自己操作才会刷新数据 → 别的窗口/工具改了状态时界面是旧的（实测踩到：外部改了 pig.pos，
      // 面板还画在老位置）。这里静默对账，只在数据真的变了时才重渲染（位置一致不会抖）。
      //
      // 两档节奏（2026-11-14，依据 archive/20261114-135230-pet-return-continuity）：
      //   • 桌宠在桌面上（原生窗口在场）→ 250 ms 一轮**令牌对账**（STORE.syncRev：几十字节），
      //     因为这时 place/motion 可以被宿主和原生窗口绕过浏览器半改掉，而 10 s 一轮快照
      //     实测就是「猪回猪圈后空着 0.16–8.36 s、两次相隔 1.1 s 的动作隔 10.03 s 才落地」的来源。
      //   • 没有桌宠 → 仍是 10 s 一轮整张快照（足以对齐别的窗口/工具改的 pos）。
      // 250 ms 的 tick 在没有桌宠时只做一次判断、不发请求，所以不会持续打宿主。
      const lastFullPollRef = useRef(Date.now());
      const lastWatchRef = useRef(Date.now());
      useEffect(() => {
        const timer = setInterval(async () => {
          const now = Date.now();
          const data = STORE.get().data;
          const petOut = !!(data && data.desktopPet && data.desktopPet.running);
          // 令牌对账：桌宠在场 250 ms 一次，空闲 1 s 一次（再过慢就发现不了"有猪出门"，
          // 而那时才切到 250 ms）。令牌变了 syncRev 自己会拉整张快照并 apply。
          if (now - lastWatchRef.current >= (petOut ? WATCH_MS : IDLE_WATCH_MS)) {
            lastWatchRef.current = now;
            await STORE.syncRev();
          }
          // 兜底：每 10 s 一张整张快照（位置不进令牌，靠它对账；老宿主没有 rev 动作时也只有它）。
          if (now - lastFullPollRef.current >= FULL_POLL_MS) {
            lastFullPollRef.current = now;
            STORE.load().catch(() => {});
          }
        }, WATCH_MS);
        return () => clearInterval(timer);
      }, []);
      const [positions, setPositions] = useState({});
      const [dragId, setDragId] = useState('');
      const offsetRef = useRef({ x: 0, y: 0 });

      const data = state.data;
      const pigs = (data && data.pigs) || [];
      const petIds = (data && data.pets) || [];
      const byId = {};
      for (const pig of pigs) byId[pig.id] = pig;
      const signature = petIds.join('|');
      // 静止的猪作为桌宠也不动：把运动开关也纳入重算条件，否则换版本后旧签名不会触发重新计时。
      // 用运动开关而不是素材类型做签名：右键改一次"允许运动"，桌宠层的计时也要跟着重算。
      const kindsSignature = petIds.map((id) => (byId[id] && pigCanMove(byId[id]) ? '1' : '0')).join('|');

      /* 每 2.2 秒重新挑落脚点：74% 移动、26% 发呆。约三成的落脚点在猪圈矩形内，
       * 于是「在桌面游走」与「回猪圈里转」是同一套行为，不是两套代码。 */
      useEffect(() => {
        /* 与桌面桌宠**同一套模型**（用户口径：「以桌宠行为为准」）：
         * 每 1.7s 决策一次、72% 发呆、单步 1.65–3.0 个身位、恒速 1 身位/秒。
         * 每只猪各自一个 nextAt，所以它们不会同步挪动。 */
        const timer = setInterval(() => {
          const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
          const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
          const now = Date.now();
          setPositions((prev) => {
            const next = Object.assign({}, prev);
            petIds.forEach((id, index) => {
              const seed = (STORE.get().seedPos || {})[id];
              // 有落点种子（刚从猪圈拖出来 / 刚被拖动过）就落在种子上，否则按屏幕右下角铺开。
              const current = next[id] || (seed
                ? { x: Math.min(vw - 48, Math.max(48, seed.x)), y: Math.min(vh - 48, Math.max(48, seed.y)), nextAt: now + DECISION_MS }
                : { x: vw * 0.68 + index * 22, y: vh * 0.66 - index * 26, nextAt: now + DECISION_MS });
              const petPig = byId[id];
              // 静止的猪：作为桌宠也只待在原地，只有用户拖动才会移动。
              if (petPig && !pigCanMove(petPig)) { next[id] = current; return; }
              if (dragId === id || REDUCED) { next[id] = current; return; }
              if (current.nextAt && now < current.nextAt) { next[id] = current; return; }
              if (Math.random() < IDLE_CHANCE) {
                next[id] = Object.assign({}, current, { nextAt: now + DECISION_MS });
                return;
              }
              const angle = Math.random() * Math.PI * 2;
              const body = (petPig && petPig.sizeRatio) || PIG_PX;
              const distance = body * (STEP_MIN_BODY + (STEP_MAX_BODY - STEP_MIN_BODY) * Math.random());
              const x = Math.min(vw - 48, Math.max(48, current.x + Math.cos(angle) * distance));
              const y = Math.min(vh - 48, Math.max(48, current.y + Math.sin(angle) * distance));
              next[id] = {
                x, y,
                // 朝向与猪圈、原生窗口一致：素材默认朝左，向右走镜像（goal 验收线 4）。
                dir: x >= current.x ? 'right' : 'left',
                // 恒速：这一段走多久由距离决定（和桌宠每帧逼近等价）。
                walkMs: Math.max(240, Math.round(Math.hypot(x - current.x, y - current.y) / body * 1000)),
                nextAt: now + DECISION_MS,
              };
            });
            for (const id of Object.keys(next)) if (petIds.indexOf(id) === -1) delete next[id];
            return next;
          });
        }, 250);
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
        // 只有「有胶囊正好到期」时才需要重渲染一次（早先每 400ms 无条件刷新，是卡顿的另一半）。
        const timer = setInterval(() => {
          const now = Date.now();
          const due = Object.keys(hoverRef.current).some((id) => {
            const deadline = hoverRef.current[id];
            return deadline && deadline <= now && deadline > now - 600;
          });
          if (due) setHoverTick((value) => value + 1);
        }, 400);
        return () => clearInterval(timer);
      }, []);
      const markHover = (id) => { hoverRef.current[id] = Date.now() + 5000; setHoverTick((value) => value + 1); };
      const isHoverLive = (id) => (hoverRef.current[id] || 0) > Date.now();

      // 空态要放在**所有 hook 之后**才返回：在 hook 之前分叉会让两次渲染的 hook 数量不同，
      // 真实 React 会直接抛「Rendered fewer hooks than expected」。这条是测试把它抓出来的。
      // 原生桌面桌宠在跑时，页面级浮层要收起来——否则同一只猪会出现两个身子
      //（一个在桌面，一个钉在 DSH 页面里）。拖动层仍然要画：它跟着指针走。
      const nativePet = !!(data && data.desktopPet && data.desktopPet.running);
      if (nativePet && !dragging && !state.toast) return null;
      if (petIds.length === 0 && !dragging && !state.toast) return null;

      return h('div', { className: 'pighub-pets' },
        (nativePet ? [] : petIds).map((id) => {
          const pig = byId[id];
          if (!pig) return null;
          // 首帧还没有摆过位置：落在右下角附近，而不是页面原点（否则会贴到左上角）。
          const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 1280;
          const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800;
          const pos = positions[id] || { x: viewportWidth * 0.74, y: viewportHeight * 0.72 };
          const isDragging = dragId === id;
          return h('div', {
            key: id,
            className: 'pighub-pet' + (isDragging ? ' is-drag' : '') + (REDUCED || isDragging || !pigCanMove(pig) ? '' : ' is-idle'),
            style: {
              left: pos.x + 'px',
              top: pos.y + 'px',
              // 与猪圈本体、原生窗口同一个 sizeRatio（视觉体量归一化）。
              width: (pig.sizeRatio || 96) + 'px',
              height: 'auto',
              transitionDuration: (pos.walkMs || 0) + 'ms',
              // 朝向镜像与猪圈/原生窗口一致
              '--pighub-dir': pos.dir === 'right' ? -1 : 1,
              transform: 'translate(-50%,-50%) scaleX(var(--pighub-dir,1))',
            },
            title: (pig.title || '猪猪') + ' · 拖动可移动；拖进猪圈或双击都回猪圈',
            onPointerEnter: () => markHover(id),
            onPointerDown: (event) => {
              if (event.button !== undefined && event.button !== 0) return;
              // 桌宠也要「拖动优先」：掐掉默认行为，否则拖过页面文字会把它选中。
              if (typeof event.preventDefault === 'function') event.preventDefault();
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
            onPointerUp: (event) => {
              setDragId('');
              // 用户口径（2026-11-13）：「还要支持拖回猪圈返回猪圈」。
              // 桌宠被拖到猪圈矩形里松手 → 放回猪圈；否则保持桌面位置。
              const pen = STORE.get().penRect;
              if (!pen || !(pen.width > 0) || !event) return;
              const inside = event.clientX >= pen.left && event.clientX <= pen.left + pen.width
                && event.clientY >= pen.top && event.clientY <= pen.top + pen.height;
              if (!inside) return;
              STORE.place(id, 'pen');
              STORE.toast('「' + (pig.title || '猪猪') + '」回猪圈了');
            },
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
              style: {
                left: dragging.x + 'px',
                top: dragging.y + 'px',
                ...(dragging.size ? { width: dragging.size + 'px', height: 'auto' } : {}),
                transform: 'translate(-50%,-50%)',
                pointerEvents: 'none',
              },
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
    const plugin = {
      name: 'dsh-pighub',
      inject: ['slots'],
      /**
       * 测试缝：`penDecide` / `penStep` 是纯函数（吃当前位置，吐下一个落脚点／整次决策），
       * 但组件里的动画由 setInterval 驱动，结构测试把定时器替换成了空实现，走不到它。
       * 与其在测试里重写一份同样的逻辑（那就是自证），不如把函数本身暴露出来——
       * `scripts/pen-motion-sample.mjs` 也用同一组函数跑离线采样，采样的是**发货的这份代码**。
       * 运行时不读这个字段。
       */
      __test: {
        penStep, penDecide, nextDecisionAt, facingFor, clampTo, penBodyPct, stepRangePct, penWidthPx,
        PEN_BOX, SETTLE_MS, DECISION_MS, IDLE_CHANCE,
        // 围栏的两层几何与分割线：测试按这一份断言「内圈 / 红框 / 活动区」三者的包含关系。
        PEN_INNER, PEN_GRASS, PEN_FENCE_SPLIT, PEN_FENCE_URL,
        PIG_PX, STEP_MIN_BODY, STEP_MAX_BODY, STEP_CAP_BODY, SPEED_BODY_PER_S, WALK_PX_PER_S,
        // 猪之间的遮挡（2026-11-14）：档位常量 + 三个纯函数。测试按这一份断言
        // 「z 随脚底单调」「整档夹在小屋与近栏之间」「同脚底按 id 稳定」，不必在测试里重写公式。
        Z_FENCE_BACK, Z_HOUSE, Z_ACTOR_MIN, Z_ACTOR_MAX, Z_ACTOR_SLOTS, Z_FENCE_FRONT, Z_SETTINGS, Z_GALLERY,
        penActorHeightPct, penFootPct, penZIndexMap, penSeedSpot,
        setPenRect: (rect) => STORE.setPenRect(rect),
        place: (pigId, to) => STORE.place(pigId, to),
        // 令牌对账：结构测试里的定时器是空实现，走不到 tick，所以直接调它来断言
        // 「令牌没变就不拉整张快照、变了立刻拉」。
        syncRev: () => STORE.syncRev(),
        storeState: () => STORE.get(),
        WATCH_MS, IDLE_WATCH_MS, FULL_POLL_MS,
        // 抽卡演出的时间轴与文本口径：测试按这一份断言（停留 2.5s / 中心 1.8 倍 / 描述截断 60 字）。
        revealTimeline, describePig, prefersReducedMotion,
      },
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
          () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pighub' }, PigHubPanelSafe)),
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

    return plugin;
  },
});