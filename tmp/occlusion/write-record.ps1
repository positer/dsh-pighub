$ErrorActionPreference='Stop'
$doc = @'
# 操作记录：猪之间按脚底判遮挡（2026-11-14 16:26–16:52 +08:00）

- **任务**：用户在猪圈里加了第二只猪之后，猪与猪之间没有前后关系（都吃 `.pighub-actor{z-index:3}` 同一个值，谁盖谁取决于 DOM 顺序）。口径：「**猪猪之间用脚底位置判断遮挡关系，下遮挡上**」。
- **本轮只改一个旋钮**：`z-index`。不动运动模型、不动围栏素材、不用 `transform`、不重排 DOM。
- 报告：[`archive/pig-occlusion.md`](../pig-occlusion.md)

## 1. 开工前状态（16:26:01 快照）

| 文件 | bytes | sha256 | mtime |
|---|---|---|---|
| `lib/client.js` | 145 504 | `c99d2e50…`（全值见 `before/`） | 16:21:06 |
| `test/client.test.mjs` | 72 942 | `8f33120c…` | 16:21:06 |

当时 `npm test` 全绿，client 43 项（含一条「远栏 1 < 小屋 2 < 猪 3 < 近栏 4」的**固定数值**断言）。
z 序当时是：草地 0、远栏 1、小屋 2、猪 3（固定值）、近栏 4、设置 5、图鉴 6。

## 2. 做了什么（按落盘顺序）

| 时刻 | 动作 | 落点 |
|---|---|---|
| 16:26–16:27 | 新增 `Z_*` 档位常量（远栏 1 / 小屋 2 / 猪 3..28 / 近栏 30 / 设置 31 / 图鉴 32）+ 说明 | `lib/client.js` 的 `CSS` 之前 |
| 16:27 | 把六条 CSS 规则的 z-index 换成常量；`front 4→30`、`settings 5→31`、`gallery 6→32` | 同上 |
| 16:27 | 新增 `penSeedSpot` / `penActorHeightPct` / `penFootPct` / `penZIndexMap` | `penBodyPct` 之后 |
| 16:28 | 渲染处：`const zById = penZIndexMap(penPigs, actors, dragId)`；actor 的 `style.zIndex` 读它 | 面板组件体 |
| 16:28 | `__test` 暴露 `Z_*` 与三个纯函数 | `__test` |
| 16:29–16:31 | 新增 3 条测试；把原 z 序用例改成「引用常量 + 关系断言」 | `test/client.test.mjs` |
| 16:36–16:45 | 写夹具（`scripts/_probe-occlusion.mjs` + `_probe-occlusion-page.js`），先冒烟、修夹具缺陷、再跑正式读数 | `scripts/` |
| 16:46:31–16:47:49 | 正式读数：3 场景 × 3 轮（间隔 11.8–12.4 s） | `probe-occlusion.json` + `shots/` |
| 16:47 | 拼版 | `compare-occlusion.png` |
| 16:47–16:52 | README / OVERVIEW / taste 写回 | 见 §5 |
| 16:50:12 | 最终 `npm test` | 120 PASS / 0 FAIL |

## 3. 夹具上踩到的四个坑（都只影响证据，不影响产品代码）

1. **`createElement('rect')` 造出来的是 HTMLUnknownElement**，放进 `<svg>` 里不画 —— 截图上草地整片空白。当时遮挡判据**全绿**，所以这类「证据看起来对、画面是假的」最危险。改用 `createElementNS(SVG_NS, …)`。
2. **SVG 属性名是驼峰即真名**（`viewBox`/`preserveAspectRatio`），不能套 React 的 kebab 映射；`setAttribute('viewBox')` 在 HTML 元素上会被小写成 `viewbox`，同样导致不画。
3. **静态页没有 `/pighub/pen/pen-fence.png` 路由**：围栏图 URL 要换成 `data:` URL，否则围栏不出现。
4. **`motion:false` 的猪首次挂载走静态网格分支、忽略宿主 `pos`**（那是运动逻辑，本轮不许改），所以夹具先按 `motion:true` 挂载（位置从 `pos` 播种）再翻成静止（静态分支保留现位置）——位置与像素才全程不变。

## 4. 验收读数（详见报告 §5–§7）

| 手段 | 读数 | 判 |
|---|---|---|
| DOM：内联 z 与脚底 | 9 轮 × 每只猪的 `z` / `脚底(px)` / `公式复算`；按脚底升序 z 严格递增 | 9/9 成立 |
| DOM：公式 vs 量到的贴图底边 | 最大差 **0.00 px**（9 轮 × 每只猪） | 成立 |
| `elementFromPoint`（判绘制顺序） | 盒子交集中心命中「脚底更低的那只」 | **15/15** |
| 像素（整图 vs 单只隔离图） | 重叠区里前排可见份额 > 后排 | **15/15**（最小 3.8×） |
| 截图 | A（1114 在前）/ B（交换后 650 在前）/ C（三只，前 = 脚底最低） | 见 `compare-occlusion.png` |

三场景的脚底（px，猪圈 421.8 px）：A = 650 **271.11** / 1114 **305.66**；B = 交换后 650 **313.37** / 1114 **263.56**；C = 650 **254.32** / 1114 **288.87** / standard-pig **332.89**，z 分别为 3 / 4 / 5。

## 5. 收尾状态（16:52）

| 文件 | bytes | sha256（前 8） |
|---|---|---|
| `lib/client.js` | 153 100 | `53d6dfa7…` |
| `test/client.test.mjs` | 81 226 | `0443b0ed…` |
| `scripts/_probe-occlusion.mjs` | 14 929 | `46d90fdc…` |
| `scripts/_probe-occlusion-page.js` | 20 597 | `59a60c32…` |
| `README.md` | 31 514 | `e4268683…` |
| `OVERVIEW.md` | 77 993 | `8ede995c…` |
| `taste.md` | 86 820 | `9924faf5…` |

`npm test`：**120 PASS / 0 FAIL**（smoke 19 / store 16 / host 22 / imaging 13 / **client 46** / lifecycle 4），16:50:12，退出码 0。

## 6. 并发（必须点名）

本轮全程有另一条线在同一个工作区改**同样两个文件**：

- `lib/client.js`：仓库小屋 `left:14%/bottom:18.5%` → `left:9.7%/top:6.7%`（压住后栏）；草地/围栏段落与 z 序注释被改写。
- `test/client.test.mjs`：z 序用例被改成引用本轮的 `__test.Z_*`（注释写「另一条线抽出来的」）。
- `README.md` / `OVERVIEW.md` / `package.json`（0.9.59 → 0.9.60）也有它的改动。

本轮的应对：每次改动都用**唯一锚点的小步 `edit`**，落盘后复核锚点仍在；`before/` 是 16:26:01 那一刻的快照，所以 `after/client.patch` 里会**同时看到两条线的改动**——本轮归属以报告 §3 的表格为准（档位常量、四个纯函数、内联 z、三条新测试）。16:28:23 发现 mtime 跳变后核过：本轮六处常量与三处渲染改动都还在。

## 7. 做不到 / 没做（照实写）

1. **没在真实 DSH 面板里手拖截图**：证据是「发货 bundle + 真实无头 Edge + 假宿主」的本地验证台。真实面板拖拽的落点由 `archive/drag-drop-origin.md` 覆盖（那是另一件事），两者合起来才完整。
2. **走动的猪层级按落点算**：CSS 过渡期间（0.9–1.7 s）层级不跟途中位置（报告 §2.3 已写明，未修）。
3. **没有单独量化「被近栏遮住多少像素」**：留给围栏那一轮的判据（`archive/pen-fence-art.md`）。
4. **没有造 13 只猪**：宿主容量 12 会挡；档位上限 28 的余量是设计值，不是实测值。

## 8. 本目录内容

~~~text
before/client.js  before/client.test.mjs        开工前的两份原文
after/client.js   after/client.test.mjs         收尾时的两份原文
after/client.patch  after/client.test.patch     与 before 的 diff（含并发线改动，见 §6）
after/_probe-occlusion.mjs  after/_probe-occlusion-page.js   本轮两支探针
after/README.md  after/OVERVIEW.md  after/taste.md          三份文档的 after 快照（它们不在 git 里）
after/hashes.json                              收尾时的 bytes/sha256/mtime
shots/                                         3 场景 × 3 轮：整图 + 单只隔离图（像素判据的原料）
probe-occlusion.json                           全部读数（DOM / elementFromPoint / 像素份额 / 时刻）
compare-occlusion.png                          三场景对照图（本目录 make-sheet.mjs 生成）
make-sheet.mjs                                 拼版脚本
~~~

## 9. 复跑

~~~powershell
node scripts/_probe-occlusion.mjs --rounds 3 --gapMs 10000 --shots tmp/occlusion/shots --out tmp/occlusion/probe.json
node archive/20261114-162601-pig-occlusion/make-sheet.mjs     # 需要 shots/ 里已有 a-r3-all.png 等
npm test
~~~
'@
Set-Content -Path 'archive/20261114-162601-pig-occlusion/record.md' -Value $doc -Encoding utf8 -NoNewline
'wrote record: ' + (Get-Item 'archive/20261114-162601-pig-occlusion/record.md').Length
