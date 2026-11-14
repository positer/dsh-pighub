# 猪之间按脚底判遮挡（「下遮挡上」）

> 用户口径（2026-11-14）：**「猪猪之间用脚底位置判断遮挡关系，下遮挡上。」**
> 归档目录：[`archive/20261114-162601-pig-occlusion/`](./20261114-162601-pig-occlusion/record.md)　·　实测：2026-11-14 16:38–16:50 (+08:00)
> 测试：`npm test` 退出码 0，**120 PASS / 0 FAIL**（16:50:12 实测）

## 0. 先写「怎样算失败」

动笔之前先把反例定下来（taste §Q.3），否则「看起来对」就是唯一判据：

| # | 反例（任一成立即失败） | 用什么看 |
|---|---|---|
| F1 | 两只猪重叠时，脚底更高的那只压住脚底更低的 | 截图 + `elementFromPoint` |
| F2 | 遮挡关系跟着 **id** 走、不跟脚底走（交换上下后关系不变） | 场景 A / B 的 z 与命中必须**翻转** |
| F3 | 三只叠在一起时，从前到后**不等**于脚底从低到高 | 场景 C 的名次表 |
| F4 | z 越界：压过近侧围栏，或掉到远栏下面 | 档位断言 + 近栏截图 |
| F5 | z 只在挂载时算一次，走动/拖动/落地后不更新 | 名次表写在 render 里（结构断言） |
| F6 | 拖动中的猪被别的猪挡住 | 拖动那只取档顶（断言） |
| F7 | 同脚底的猪在相邻两帧之间来回抢层（闪烁） | 第二关键字 id（断言） |

## 1. 算法：脚底（footY）怎么算

~~~text
footPct  = centerY + heightPct / 2
heightPct = sizeRatio / 猪圈宽 × 100 × aspect      // 猪圈 1:1，所以「宽百分之几」== 「高百分之几」
aspect    = manifest 的 size.height / size.width   // lib/index.js 已在快照里下发（保留 3 位小数）
~~~

**为什么不是 top**：actor 的 `left/top` 是**中心**（CSS `transform: translate(-50%,-50%)`），
而遮挡要比的是**贴图底边**。库里的贴图是构建期紧裁到猪身的（`assets/img/*`），所以贴图底边就是脚底。
渲染高度不是估的：`img{width:100%;height:auto}`，宽 = `sizeRatio` CSS px，高 = 宽 × 贴图固有高宽比，
而固有高宽比就是清单里的 `size`，快照的 `aspect` 正是它。

**这条公式是量出来的，不是推出来的**：探针在真实浏览器里读 `img.getBoundingClientRect().bottom`
（这一帧真正画在哪），与公式复算并排比：

~~~text
9 次测量 × 每只猪：|measured − formula| 最大值 = 0.00 px
~~~

尺寸不同也成立：场景 C 三只的 sizeRatio / aspect 是 86.32 / 1.158、95.32 / 0.895、98.86 / 0.898，
渲染高 103.7 / 88.5 / 92.2 px，脚底 254.32 / 288.87 / 332.89 px。三只中心 y 相差 10 个百分点，
谁在前由**加上半个高度之后**的脚底决定 —— 这正是「不能直接拿 top 比」的证据。

## 2. z：一档区间 + 档内名次

### 2.1 档位表（唯一一处写死；CSS 与内联 z 都从这里取）

| 层 | z | 常量 |
|---|---|---|
| 草地裁剪盒 | 0 | `Z_GRASS` |
| 远侧围栏 | 1 | `Z_FENCE_BACK` |
| 仓库小屋 | 2 | `Z_HOUSE` |
| **猪** | **3 … 28** | `Z_ACTOR_MIN` … `Z_ACTOR_MAX`（档宽 `Z_ACTOR_SLOTS = 26`） |
| 近侧围栏 | 30 | `Z_FENCE_FRONT` |
| 设置按钮 | 31 | `Z_SETTINGS` |
| 图鉴覆盖层 | 32 | `Z_GALLERY` |

三条硬约束都写成了断言（`test/client.test.mjs`）：

1. `Z_FENCE_BACK < Z_HOUSE < Z_ACTOR_MIN` —— 猪压小屋、小屋压远栏；
2. `Z_ACTOR_MAX < Z_FENCE_FRONT` —— **整档**低于近栏（走到底边的猪被前景围栏挡住一截）；
3. `Z_FENCE_FRONT < 40` —— 整档留在 40 以下。**这条是上限的依据**：`.pighub-pen` 只是
   `position:relative + overflow:hidden`，**不构成层叠上下文**，所以猪圈里的 z 直接和页面其它浮层比大小：
   右键菜单/背板 40/41、页面级桌宠层 `.pighub-pets` 41、抽卡演出 59/60/61、toast 62。
   档位一旦越过 40，猪圈里的东西就会盖到这些层上 —— 这也解释了为什么没有拿 `10 + round(footY)` 直接铺 0..560。

> **连带改动（必须，否则会被前景围栏盖住）**：`.pighub-settings` 5 → 31、`.pighub-gallery` 6 → 32、
> `.pighub-fence.is-front` 4 → 30。数值全部集中在 `Z_*` 常量里，cssRule 断言按常量读，不写死数字。
> 档宽 26 = 猪圈容量 12 的两倍余量；名次最多 12 个，上限 28 用不满。

### 2.2 档内：给**名次**，不给 z = f(脚底)

~~~js
penZIndexMap(pigs, actors, draggingId)   // → { [id]: z }
  rows = pigs.map(→ { id, foot: penFootPct(actor, pig) })
  rows.sort(脚底升序, 同脚底按 id)        // 拖动中的那只排最后
  z[id] = Z_ACTOR_MIN + rank              // rank = 0..N-1
~~~

为什么不是 `zIndex = BASE + round(footY)`：

1. **精度**：脚底换算成整数会把差别抹平 —— 26 个槽覆盖 0..560 px ≈ **每 20 px 才分得开一次**；
   两只差 5 px 的猪就只能靠 id 兜底，于是「下遮挡上」在某些对子上退化成「id 遮挡上」。
   名次是精确的：本轮相邻两只的脚底差 34.5 / 44.0 px，全都靠脚底本身分出先后。
2. **够用**：一档只要放得下圈里的猪（容量 12）。多出来的槽是给「容量以后变大」留的，不是给分辨率。
3. **同脚底**：第二关键字是 id（字符串比较），两只脚底**完全相等**时顺序由 id 决定、与这一帧的渲染次序无关
   → 不会在相邻两帧之间互相抢层（F7）。
4. **拖动**：拖动中的那只排在名次表最后 = 取这一档的**顶**（28）。「拖起来不能被挡住」与「不许压过近栏」
   因此同时成立（F6）。

### 2.3 每帧重算

~~~js
// PigHubPanel 组件体里、return 之前
const zById = penZIndexMap(penPigs, actors, state.drag && state.drag.active ? state.drag.id : null);
// 渲染
style: { ..., zIndex: zById[pig.id] || Z_ACTOR_MIN, ... }
~~~

游走一步（`setActors`）、拖动（`beginDrag/moveDrag`）、落地（`moveActorTo` → `setActors`）、
回圈（effect 重新播种）都会触发重渲染 → 名次表跟着位置重算（F5）。

**已知边界（照实写）**：CSS 过渡的 0.9–1.7 s 里 actor 的**状态**已经是落点，所以层级按**落点**算，
不按途中位置。走动途中两猪交叉的那一瞬间，层级可能提前/滞后于视觉位置。没有修：要修就得逐帧读
`getBoundingClientRect`，等于用 DOM 读取替代状态，代价是每帧强制布局。

## 3. 改了哪些行（`lib/client.js`，本轮 hunk）

| 位置 | 改动 |
|---|---|
| `CSS` 之前 | 新增 `Z_*` 档位常量 + 一段说明（唯一一处写死 z 序的地方） |
| `.pighub-grass-clip` | `z-index:0` → `' + Z_GRASS + '`（值不变） |
| `.pighub-house` | `z-index:2` → `' + Z_HOUSE + '`（值不变） |
| `.pighub-fence.is-back` | `1` → `Z_FENCE_BACK`（值不变） |
| `.pighub-fence.is-front` | `4` → `Z_FENCE_FRONT`（**4 → 30**，给猪那一档腾出 3..28） |
| `.pighub-actor` | `z-index:3` → `Z_ACTOR_MIN`（= 3；只是「没有内联值时」的默认） |
| `.pighub-settings` | `5` → `Z_SETTINGS`（**5 → 31**，否则被前景围栏盖住） |
| `.pighub-gallery` | `6` → `Z_GALLERY`（**6 → 32**，同上） |
| `penBodyPct` 之后 | 新增纯函数 `penSeedSpot` / `penActorHeightPct` / `penFootPct` / `penZIndexMap` |
| actor 渲染 | `style.zIndex` 改成读 `zById`；种子改用 `penSeedSpot(pig, index)`（删掉重复的网格常量） |
| `__test` | 暴露 `Z_*` 与三个纯函数（测试按这一份断言，不在测试里重写公式） |

**没动**：运动模型一行没改（`penDecide` / `penStep` / `penBodyPct` / `PEN_BOX` / `usePenActors` 的判定分支）、
围栏换图那条线的产物（`assets/img/pen-fence.png` 与切分脚本）、DOM 顺序、`transform`。

## 4. 证据一：截图（同一台夹具、同一份发货 bundle）

夹具：`scripts/_probe-occlusion.mjs` + `scripts/_probe-occlusion-page.js` —— 真实无头 Edge 158 + **发货的**
`lib/client.js` 与 CSS；假件只有 React 与 `/pighub` 应答（都不是被测代码）。三只猪用清单里的真实
`sizeRatio` / `aspect` 与真实贴图：`pighub-650`（猪搬运）、`pighub-1114`（你是小猪）、`standard-pig`（普通猪）。

![三场景对照](./20261114-162601-pig-occlusion/compare-occlusion.png)

- **A**：650（脚底 271 px，z=3）在上、1114（脚底 306 px，z=4）在下 → **下面那只在前**，
  上面那只的肚子被压住，只剩货箱露在外面。
- **B**：只把两只的中心 y 交换（其余一切不变）→ 关系**翻转**（脚底 313 px 的 650 在前，它的货箱压住 1114 的脸）。
  这条同时排掉「固定按 id 排序」（F2）。
- **C**：三只叠成一串，从前到后 = `standard-pig`(333) > `pighub-1114`(289) > `pighub-650`(254)。
- 三张都能看到围栏：猪画在**远栏之后、近栏之前**，近栏有木料的地方（四条边）没有一只猪盖上去（F4）。

## 5. 证据二：同一时刻的 DOM 读数（内联 z 与脚底）

两侧对照列就是判据：`脚底 = 贴图底边`（量出来的）与 `公式复算`（`脚底 = 中心 + 渲染高/2`）。

{{DOM_TABLE}}

- **脚底单调 ⇒ z 单调**：每一轮里按脚底升序取 z，都**严格递增**（`z[i-1] < z[i]`），9/9 轮成立（F1/F3）。
- **公式复算与量出来的底边逐值相同**（差 0.00 px）：说明「脚底 = 中心 + 渲染高/2」在真实布局里成立。
- 同一轮内 z 互不相同（满圈 12 只也不会撞），任何一对猪都分得出前后。

{{ORDER_LINES}}

## 6. 证据三：`elementFromPoint` 命中（判绘制顺序，与像素无关）

在**两个 actor 盒子的交集中心**取点，问浏览器「这一点命中的是谁」。命中者必须是脚底更低的那只。

{{HIT_TABLE}}

合计 **{{HIT_OK}}/{{HIT_TOTAL}}** 命中「脚底更低的那只」。
> `elementFromPoint` 判的是**元素在绘制顺序上的先后**（不看 alpha），所以它是 z 序的直接读数；
> 「看起来谁在前面」由第 7 节的像素判据回答 —— 两者独立。

## 7. 证据四：像素（整图 vs 单只隔离图）

做法：同一次测量里连拍三张 —— 整图、只画 A、只画 B（其余 actor 置 `display:none`）。在**两个盒子的重叠矩形**里
逐像素比较：统计「整图这一点等于 A 单独渲染、且不等于 B」的像素数（= A 的可见份额），反之亦然。
两只贴图不同，重叠区里必然有大量只有一只才有的像素，所以这是可量的，不是目测。

{{PIX_TABLE}}

合计 **{{PIX_OK}}/{{PIX_TOTAL}}** 个「猪对 × 轮」里，前排可见份额大于后排（全部同向，最小倍数 **{{MIN_RATIO}}×**）。
> 后排的「可见」不是 0：那是被盖住时露出的描边/投影边缘（drop-shadow 在 1 px 抗锯齿带里）。
> 这个列量的是「重叠区里还有多少像素只属于后排」，不是「后排完全不可见」。

## 8. 测试

~~~sh
npm test        # 退出码 0
~~~

| 文件 | PASS |
|---|---|
| smoke | 19 |
| store.test | 16 |
| host.test | 22 |
| imaging.test | 13 |
| **client.test** | **46**（本轮 +3） |
| lifecycle.test | 4 |
| 合计 | **120** |

本轮新增三条（`test/client.test.mjs`）：

1. **脚底 = 中心 y + 渲染高度 / 2**：高度按 `sizeRatio × aspect`；`aspect` 必须真的参与（同宽更扁的贴图脚底更低）；
   `top` 更高但脚底更低时按脚底算；缺字段回落不许 NaN。
2. **z 名次**：脚底越低 z 越大（严格单调）；整档夹在 `Z_HOUSE` 与 `Z_FENCE_FRONT` 之间；同脚底按 id 稳定；
   拖动那只取档顶且其余三只的相对顺序不变；满圈 12 只拿到 12 个不同 z 且不越界。
3. **渲染**：每只猪的 z 写在**内联 style** 上、落在档内、绘制顺序等于脚底顺序；并断言名次表由
   `penPigs + actors` 每帧现算（结构断言：防有人把它挪回挂载时算一次）。

另外把原来那条 z 序断言改成**引用 `__test.Z_*` 常量 + 关系断言**（三条大小关系 + `Z_FENCE_FRONT < 40`），
以后调动档位时红的是「顺序错了」，不是「数字变了」。

## 9. 并发：哪些不是本轮写的

本轮全程有**另一条线在同一个工作区改同样两个文件**：

- `lib/client.js`：仓库小屋从 `left:14%/bottom:18.5%` 挪到 `left:9.7%/top:6.7%`（压住后栏），
  并把 z 序注释改成「小屋 2 < 猪 3」；草地/围栏那几段也被它改过。
- `test/client.test.mjs`：z 序那条用例被改成引用本轮的 `__test.Z_*`（注释写着「另一条线抽出来的」）。
- `README.md` / `OVERVIEW.md` / `package.json`（0.9.59 → 0.9.60）同样有它的改动。

落盘方式：每次改动都用**唯一锚点的小步 `edit`**，改完复核锚点仍在；`before/` 是 16:26:01 那一刻的两份文件，
所以本轮 diff 可以按那一刻对账。**归属**：档位常量、四个纯函数、内联 z、三条新测试是这一轮；
小屋位置与围栏相关注释不是。

## 10. 做不到 / 没做

1. **没在真实 DSH 面板里手拖**：证据来自「发货 bundle + 真实浏览器 + 假宿主」的本地验证台（README「验证」那一套的延伸）。
   真实面板里的拖拽由 `archive/drag-drop-origin.md` 那条线覆盖 —— 它证明的是落点，不是遮挡，两者合起来才完整。
2. **走动的猪层级按落点算**（§2.3），没有逐帧按 `getBoundingClientRect` 修正。
3. **近栏的「挡一截」没有单独量化**：截图上能看到猪在近栏之后（木料上没有被猪盖住的像素），
   但没做「被近栏遮住的像素计数」——那属于围栏那一轮的判据（`archive/pen-fence-art.md`）。
4. **没有造 13 只猪的场景**：宿主侧猪圈容量 12 会挡住，档位上限 28 的余量是设计值，不是实测值。

## 11. 红线核对

| 红线 | 状态 | 证据 |
|---|---|---|
| 不改猪的运动逻辑 | ✔ | `penDecide/penStep/penBodyPct/PEN_BOX/usePenActors` 的判定与常量零改动 |
| 不改围栏换图那条线的产物 | ✔ | 本轮没写 `assets/**`、没动切分脚本；围栏的 z 只是 4 → 30 |
| 不用 transform / DOM 重排实现遮挡 | ✔ | 遮挡只由 `z-index` 实现；actor 的 `transform` 一行没动，DOM 顺序没变 |
| 拖动中的猪在最上层 | ✔ | `penZIndexMap(..., dragId)` 把拖动那只排到最后 = 档顶 28，并有断言 |