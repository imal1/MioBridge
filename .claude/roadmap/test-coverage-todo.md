# 测试覆盖 — 剩余待办

已完成：Windows 路径断言修复、CI v8 coverage job、core+cli 单测缺口补齐（core 70 绿）、
`packages/integration` 契约测试（71 绿）。

## 已解决：#4 集成测试（未做 39 路由重写）

原计划把 ~39 个 dashboard 端点从 `DashboardRouteRegistry` + `reply.hijack()`
重写为 fastify 原生路由，前提是「hijack 挡住了 `app.inject()`」。**该前提经实测为假**：
inject 能正常穿过 hijack（JSON、streaming write、自定义 header、404 fallthrough 全通）。

实际落地的最小方案：

- `createDashboardApp()` — 从 `runNodeDashboardServer` 抽出建 app 的部分，不绑 socket。
  运行时与测试走同一条路由/解析/错误信封代码路径。
- `packages/integration` — 用 `app.inject()` 打真实 app，依赖端口用 Proxy 打桩。
- 端点清单从服务端自己的 `/api/openapi.json` 读取，**手维护的 OpenAPI 表一旦漂移**
  （声明了但没注册、改名没同步）测试即红。
- ajv 校验两套 envelope 方言：application（`requestId`/`role`/结构化 error）
  与 legacy（裸字符串 error）。加错误路径：非法 JSON → 400、超 1 MiB → 413、未知路由 → 404。

若日后要**服务端请求体 schema 校验**（拒绝非法入参，而非仅校验响应），那才需要原生路由重写；
届时可按路由组分批做，每组保持旧测试绿。目前无此需求。

## 顺手修掉的既有缺陷

- `packages/e2e` 引用了未声明的 `@miobridge/cli` 与 `yaml`，只靠 hoisting 侥幸工作；
  声明后 e2e typecheck 从 67 个 implicit-any 错误归零。

## 可选补测（ponytail 判低价值，缺 coverage gate 时再做）

- [ ] core `StatusService`（fs 重，需临时目录）
- [ ] cli 0 覆盖模块：`dashboard/commands`、`ssh/kernels`、`ssh/mihomo`、`ssh/agent`、`platform/linux`（多数 Linux/fs 相关，Windows 本地跑不了）
- [ ] SSE 端点（`/api/*/events`）需要带取消的测试，一次性 inject 会挂住，当前从契约扫描中排除

## Dashboard E2E 与重设计对齐（PR #38）

界面从 11 页收敛到 6 页，`/deploy` `/agents` `/runtimes` `/outputs`
`/subscription-status` `/actions` 全部变成重定向，原页面成为节点详情面板的标签页。
E2E 有 69 个测试仍按旧信息架构断言，每个都跑到 30s 超时，光重试就吃掉约 16 分钟，
导致 Dashboard E2E job 连续在 20 分钟上限被 cancel。6 个 spec 已全部重写，
本地全套 140 个 3.4 分钟跑绿。

被删掉的界面里仍有服务端行为的，改为直接打接口而不是连测试一起删：

- `先卸载再删除` → `DELETE /api/cluster/nodes` force=false 的互斥
- `手动 Shell 部署` 对话框 → `GET /api/deployments/agent/manual-config`
- 部署事件时间线（仍走 SSE，只是不再渲染）→ 事件接口的步骤与时间戳
- 配置导入预览 → `POST /api/config/import/preview`
- Webhook 测试与历史 → `POST /api/notifications/test` + `GET /api/notifications/history`

### 本地跑 e2e（Windows）

`bun` 在 Windows 上喂不出 Playwright `--remote-debugging-pipe` 需要的额外 fd，
浏览器进程起来了但 CDP 握手永远不完成（180s 超时）。用 node 跑 Playwright CLI 正常：

```
cd packages/e2e
export PATH="$APPDATA/fnm/node-versions/v24.18.0/installation:$PATH"
MIOBRIDGE_E2E_CHROME=1 node node_modules/@playwright/test/cli.js test --project=desktop-chromium
```

`MIOBRIDGE_E2E_CHROME=1` 走系统装的 Chrome 并关掉录像（录像依赖 Playwright 自带的
ffmpeg，同一份缓存里没有）；CI 不设这个变量，仍用自带 Chromium。

改 cli 或 frontend 的源码后必须先 `bun run --cwd packages/<pkg> build`：
e2e harness 引的是 dist，不是 src。

顺带修掉的两个真问题（不是测试问题）：

- `staticServer.ts` 的 `resolveSafe()`：`normalize('/nodes')` 在 Windows 上得到
  `\nodes`，代码只剥 `/`，于是 resolve 到 root 之外 —— Windows 上 dashboard 对
  所有路径回 403。`static-assets.test.ts` 从 6 fail 变 8 pass。
- 方法不匹配时回 404 —— 现在 `DashboardRouteRegistry.methodsFor()` 让
  `nodeServer` 回 405 + `Allow`，TRACE 之类不再看起来像路径写错了。

### 界面缺口（测试已记录，产品待修）

- 订阅预检请求失败时页面什么都不显示，只留一个禁用的「创建生成任务」，用户无从区分
  「没有可读来源」和「服务端挂了」。已用 `test.fail()` 钉住，修好后会「非预期通过」。
- 订阅策略的「备份保留」只读（`备份保留 N 份`），其余四项可编辑；接口支持写，界面没给入口。
- 日志页的「未选节点」分支不可达：有节点时页面自动选中第一个，只有集群为空时能触发。

## 已知不修

- cli ~21 个 Windows 失败 — CI 是 Linux，不修（本次重构前后均为 21 failed / 149 passed）
- `src/lib/api.ts` 里 `notifications/test`、`notifications/history` 两个客户端方法已无 UI 调用方（死代码，与测试无关）
- `ssh2` 的 native 可选依赖在 Windows 下 node-gyp 构建失败 — 可选依赖，不影响功能
