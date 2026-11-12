# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)；每条记录只写「对使用者可见的变化」，
内部重构不单列。README 只描述项目整体，**版本相关内容一律记在这里**。

## [0.2.0] — 2026-11-12（未发布）

### Added

- **冻结素材库**：`assets/manifest.json` 带 `assetVersion` 与每张源图的 sha256/bytes；抽猪池只认它，实时目录降级为「下一版候选池」。
- **逐图判定**：`assets/judgements.json` 给每张候选定义 `kind`（`live`/`dead`）、定制裁切框、去白阈值与判定理由；构建脚本强制一一对应，缺一条或多一条都失败。
- **死猪 / 活猪**：死猪完全静止、只能由用户拖动、不响应点击；活猪游走、发呆、点击有弹性回弹；作为桌宠时同样遵守。
- **矢量图化**：逐图判定 `vector=true` 的图会被描摹成自包含 SVG（量化 → marching squares → Douglas–Peucker → path），以 `data:image/svg+xml` 交给 `<img>`，任意放大都不模糊；场景/照片类整图保留位图（描摹会更脏）。
- **去白底透明**：Host 半新增同源图片代理 `GET /pighub/image?src=...`（白名单主机、限 8 MB、不落盘），浏览器用 canvas 漫水填充把与边框连通的白抠成透明；裁切与阈值逐图不同。
- **设置按钮**（面板整体右上角）：星级显示三档（关闭 / 默认 5 秒 / 常驻）、素材库版本与来源、下一版候选池规模、数据目录。
- 多来源候选池：实时接口 + 开源镜像（GitHub 目录），按文件名合并去重。
- **抽取动画**：从「今日猪猪」按钮**弹出**（缩放 + 轻微回弹 + 9 颗火花），随后**旋转 720° 收进猪圈**，落点取这只猪真实的 DOM 中心（实测偏差 0 px）；飞行期间真正的猪先隐藏，落定后出现。

### Changed

- **跟随亮/暗色主题**：面板、清单、弹层、桌宠与动效的全部颜色改为 DSH 主题令牌（`--dsw-alias-*`）；猪圈草地/围栏用 `color-mix` 与背景令牌混色。不写死颜色、不判断亮暗，主题切换由壳体令牌自动完成。实测对比度：亮色 row 18.9 / meta 5.8 / pop 18.9，暗色 row 15.03 / meta 12.11 / pop 11.57（WCAG AA 正文要求 4.5）。
- 星级胶囊由「只在清单里」改为「显示在对应猪猪上方」，并按 `prefs.starDisplay` 三档控制。
- 清单每行标出「活猪 / 死猪」与「桌宠」。

### Fixed

- 面板与桌宠层在空态时提前返回，会让两次渲染的 hook 数量不同（真实 React 会抛 *Rendered fewer hooks than expected*）——改为所有 hook 之后再返回空态。
- `prefs` 只改一个字段时会重置另一个偏好——改为只写显式给出的字段。

### Tests

- 四份离线测试共 **57 项断言**（smoke 14 / store 13 / host 17 / client 13）。
- 版面验证台新增 alpha 与 motion 两个探针，读数写进 `<title>`；本版本实测 `live=1/1 dead=0/4 pets=1/1`，活猪四角 alpha 全 0。
## [0.1.0] — 2026-11-12（未发布：等仓库与 Trusted Publishing 配对后再走 CI 发）

### Added

- 侧边栏入口与 PigHub 面板：带围栏的正方形猪圈、像素风标题、今日猪猪按钮、猪猪清单（按获取时间 / 星级 / 稀有度排序）。
- 每日一次随机抽取；重复获得同一只猪升 1 星，分别记录首次获得时间与最近升星时间。
- 猪圈内的弹跳、游走与发呆行为。
- 把猪猪从猪圈拖出成为置顶桌宠，在整个页面与猪圈范围内游走，可拖回猪圈。
- 与 DSH 生态其他桌宠共存：独立 z-index 层、容器 `pointer-events: none`、样式标签与类名全部带插件前缀、尊重 `prefers-reduced-motion`。
- 数据统一落在 `~/.PigHub/`（`state.json` / `catalog.json` / `prefs.json`）。

### Changed

- 插件不再把 `webServer` 写进 `inject`：实测它在没有 Web 服务的 profile 里会让**整个装配启动失败**（`1 entry did not activate`）。改为按需查找，拿不到就只禁用数据路由，工具照常可用。
- 版本信息从 README 移到本文件；公开仓库忽略 agent 行为文档（`archive/`、`taste.md`、`OVERVIEW.md`、`AGENTS.md`）。
- 发布方式从「本地 token」改为「GitHub Actions + npm Trusted Publishing + provenance」。

### Tests

- `npm test`：契约 13 + 规则 13 + HTTP 面 13 = 39 项断言；`test/client.test.mjs` 另有 10 项结构断言（含真实拖拽 → 桌宠路径）。
- `test/demo/pighub-demo.html`：版面验证台，可用 headless 浏览器截图复核。

## [0.0.1]

### Added

- npm 占位发布，锁定包名 `dsh-pighub`。
- 最小 DSH bundle：`dsh.bundle.patch` → `cordis.patch.yml` → `lib/index.js`。
- 只读工具 `pighub_about`：回传版本、数据目录与目录缓存状态。
- 离线冒烟测试（`test/smoke.mjs`），挂在 `prepublishOnly`。