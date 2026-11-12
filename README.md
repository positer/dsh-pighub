# dsh-pighub

**PigHub（猪猪库）的 DeepSeek Harness 插件：**在侧边栏养一个猪圈。每天领一只猪猪，重复的升星，攒够了把猪拖到桌面上遛。

猪猪素材来自 [PigHub](https://pighub.top) 与它的开源镜像，但**每个版本都冻结一次**：本版本用哪几只猪、每只是「死猪」还是「活猪」、怎么裁、怎么去白底，全部写在 `assets/manifest.json` 里。插件不打包图片字节，只用冻结下来的判定与参数。

## 它长什么样

- **侧边栏入口**：一只朝右看的小猪，与已有入口同尺寸、同描边。
- **猪圈面板**：左边带围栏的正方形猪圈；右上像素风标题（手写 5×7 位图字模），其下「今日猪猪」；再往下是可排序的猪猪清单。
- **设置按钮**在面板整体右上角：星级显示三档（关闭 / 默认 / 常驻）、素材库版本与来源、下一版候选池、数据目录。
- **每日一只**：一天抽一次，池子是本版本冻结库；重复获得同一只升一星，分别记录「首次获得」与「最近升星」。
- **抽取动画**：从你按下的按钮弹出（缩放回弹 + 火花），再旋转着飞进猪圈，**落点就是这只猪真实的落点**（不是估算，见「验证」里的 landGap）。
- **死猪 / 活猪**：判定为死猪的**完全静止**，只能由用户拖动；活猪会自己游走、偶尔发呆，点一下有弹性回弹。
- **桌宠**：把猪拖出猪圈即成为置顶桌宠，可拖动；活猪会自己溜达（约三成落脚点落回猪圈），双击回圈。哪些猪在猪圈外，记录在 `state.json` 的 `pets` 里，清单上会标「桌宠」。

## 素材：冻结、逐图判定、定制切分

```text
assets/sources.json     候选池（从公开目录里挑出来的候选）
assets/judgements.json  逐图判定：kind(live/dead) + 裁切框 + 去白阈值 + 判定理由
assets/manifest.json    冻结产物：上面两张 + 每张源图的 sha256/bytes + assetVersion
```

构建：`npm run assets:build`。它有两条硬约束：**候选池里每一张都必须有判定**（少一条或多一条都直接失败），**每一张都必须有理由**。所以「逐图判定」是构建的前置条件，不是口号。

同一套流程里还有**矢量图化**：判定为平涂卡通的图会被描摹成自包含 SVG（量化 → 等值线 → 简化 → 路径），以 `data:image/svg+xml` 渲染，**放大不模糊**；场景/照片类整图保留位图，因为描出来只会更脏。是否描摹同样逐图记录在判定表里。

去白底在浏览器里做：Host 半开一条同源代理 `GET /pighub/image?src=...`（白名单主机、限大小、不落盘），前端拿到字节后用 canvas 漫水填充把「与边框连通的白」抠成透明。走同源代理的原因很具体——**上游图片不带 CORS 头**，直接读像素会把 canvas 标成 tainted。裁切框与阈值逐图不同，所以同一张源图在任何机器上切出同一个结果。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-pighub
```

装完重启 DSH：Host 半负责数据与抽取，浏览器半在启动时进图。

## 数据放在哪

所有本地数据都在用户主目录的 `/.PigHub/：

| 文件 | 内容 |
|---|---|
| `state.json` | 拥有哪些猪（含活/死判定与切分参数）、星级、首次获得与最近升星、每日抽取记录、**桌宠列表** |
| `catalog.json` | 下一版候选池的目录缓存（只有 id/标题/文件名/URL） |
| `prefs.json` | 排序偏好与星级显示档位 |

状态文件损坏时不会静默覆盖：原文改名为 `state.json.corrupt-<时间戳>` 留着，插件退回空状态继续可用。

## 结构

```text
dsh-pighub/
├── lib/index.js             Host 半：读盘、POST /pighub、GET /pighub/image、pighub_about
├── lib/store.js             抽取 / 升星 / 排序 / 原子写盘
├── lib/assets.js            冻结库读取（抽猪池只认它）
├── lib/client.js            浏览器半：closure-factory bundle，注册三个槽位
├── assets/                  冻结素材库（候选 / 判定 / 产物）
├── scripts/build-assets.mjs 冻结库构建（逐图判定校验）
├── test/                    离线测试（发布闸门）
└── .github/workflows/       pack → OIDC 发布
```

浏览器半只用官方增量槽位：`sidebar.panellist`（入口）、`main`（面板，key 与入口 id 相同）、`shell.overlay`（页面级桌宠层）。

## 与其他桌宠插件共存

插件市场上的桌宠（例如 [dsh-pet](https://www.npmjs.com/package/dsh-pet)）都是页面级浮层，所以按同一套既有约定来：容器 `pointer-events: none`、自有 z-index 层、样式标签与类名全带 `dsh-pighub` / `.pighub-` 前缀、尊重 `prefers-reduced-motion`。

## 验证

```sh
npm test                  # 65 项离线断言：契约 / 规则 / HTTP 面 / 矢量描摹 / 浏览器半结构
```

界面另有一套**本地**验证台（不随仓库分发、不进 npm 包）：它按宿主契约把 `lib/client.js` 挂到普通页面上，并埋四个探针——

- **alpha**：把渲染出来的图重画到 canvas 逐像素读四角 alpha，证明白底真被抠掉；
- **motion**：4.2 秒前后各采一次落脚点，分别统计活猪/死猪/桌宠移动了多少只；
- **reveal**：自动点一次「今日猪猪」，采样动画阶段并比较落点与真身中心的像素差；
- **svg**：统计以 `data:image/svg+xml` 渲染的图数量，确认矢量化的就是那些图。

当前基线：`live=1/1 dead=0/4 pets=1/1`、活猪四角 alpha 全 0、`landGapPx=0`、`svg=2`。

## 发布

走 **GitHub Actions + npm Trusted Publishing**，仓库里不放长期 token：`pack` job 无凭据校验 tag 与版本并跑全部测试，`publish` job 消费同一份 tarball，用 OIDC 换短期凭据发布并生成 provenance。npm 后台三项匹配（仓库 / `publish.yml` / `npm-publish`）任一不符都会被拒。

## 许可

- **本插件代码**：MIT，见 [LICENSE](./LICENSE)。
- **上游 PigHub 素材**：未声明数据许可。本包**不含图片字节**，只含判定与参数；图片由用户浏览器按冻结 URL 直取。若上游给出许可条款，以它为准。

版本变化见 [CHANGELOG.md](./CHANGELOG.md)。