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

## 已知不修

- cli ~21 个 Windows 失败 — CI 是 Linux，不修（本次重构前后均为 21 failed / 149 passed）
- `ssh2` 的 native 可选依赖在 Windows 下 node-gyp 构建失败 — 可选依赖，不影响功能
