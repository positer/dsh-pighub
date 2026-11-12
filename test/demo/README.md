# test/demo — 版面验证台

不是产品的一部分，也不进 npm 包（`files` 只收 `test/*.mjs`）。

## 生成方式

```sh
node test/demo/build-demo.mjs     # 或 npm run demo:build
```

页面是**生成**的，不是手写：演示数据直接从 `assets/manifest.json` 读，所以每张图的
`kind`（死猪/活猪）与裁切参数永远跟冻结库一致——手抄一份就会在改版本时漂移。

## 它做什么

1. 放一个假的 `window.__ModuleLoader__` 捕获 bundle 注册的 `factory`；
2. 用本地 React（`vendor/`）物化它，给一个只实现 `ctx.effect` / `ctx.slots` 的假 ctx；
3. 把三个槽位组件挂到左侧栏、主区域、页面级浮层；`fetch` 换成按 URL 分流的假件：
   `/pighub` 回快照，`/pighub/image` 回 `vendor/pigs/<id>.img` 的字节。

## 两个探针（这是重点）

页面在 7.2 秒后把读数写进 `<title>`：

- **alpha**：把每只猪渲染出来的图重画到 canvas，逐像素读四角 alpha。
  `[b]` 表示用的是 blob:（本地抠好的透明 PNG），不是远端原图。
- **motion**：记录 4.2 秒前后的落脚点，按 `kind` 分别统计活猪/死猪/桌宠移动了几只。

```sh
# 起一个静态服务器（验证台要 fetch 本地文件）
node <临时脚本> <dsh-pighub 绝对路径> 0
# 再 headless 打开：
msedge --headless=new --disable-gpu --virtual-time-budget=16000 \
  --dump-dom "http://127.0.0.1:<port>/test/demo/pighub-demo.html"
```

当前基线：`live=1/1 dead=0/4 pets=1/1`，两只活猪四角 alpha 全 0。

## vendor/

- `react.js` / `react-dom.js`：React 18.3.1 UMD 生产构建（MIT，取自 unpkg），让验证台离线可跑；
- `pigs/*.img`：6 张候选源图的本地副本，**只为验证台存在**，已在 `.gitignore` 中，不进仓库也不进包。
