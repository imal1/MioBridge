# 测试覆盖 — 剩余待办

分支 `test/windows-crossplat-ci-coverage` 已完成：Windows 路径断言修复、CI v8 coverage job、core+cli 单测缺口补齐（core 70 绿）。

## #4 大件（多 session）

从 `DashboardRouteRegistry` + `reply.hijack()` 重写为 fastify 原生路由：

- [ ] ~39 个 dashboard 端点改为 fastify 原生路由 + JSON schema
- [ ] 新建 `packages/integration`，用 `app.inject()` + schema 校验
- [ ] 分批做，每组路由保持旧测试绿

## 可选补测（ponytail 判低价值，缺 coverage gate 时再做）

- [ ] core `StatusService`（fs 重，需临时目录）
- [ ] cli 0 覆盖模块：`dashboard/commands`、`ssh/kernels`、`ssh/mihomo`、`ssh/agent`、`platform/linux`（多数 Linux/fs 相关，Windows 本地跑不了）

## Dashboard E2E 与重设计对齐（PR #38）

界面从 11 页收敛到 6 页，`/deploy` `/agents` `/runtimes` `/outputs`
`/subscription-status` `/actions` 全部变成重定向，原页面成为节点详情面板的标签页。
E2E 有 31 个测试仍按旧信息架构断言，每个都跑到 30s 超时，光重试就吃掉约 16 分钟，
导致 Dashboard E2E job 连续在 20 分钟上限被 cancel。已重写 5 个 spec 对齐现状。

被删掉的界面里仍有服务端行为的，改为直接打接口而不是连测试一起删：

- `先卸载再删除` → `DELETE /api/cluster/nodes` force=false 的互斥
- `手动 Shell 部署` 对话框 → `GET /api/deployments/agent/manual-config`
- 部署事件时间线（仍走 SSE，只是不再渲染）→ 事件接口的步骤与时间戳
- 配置导入预览、Webhook 测试/历史 → 对应的三个接口

## 已知不修

- cli ~21 个 Windows 失败 — CI 是 Linux，不修
- `src/lib/api.ts` 里 `notifications/test`、`notifications/history` 两个客户端方法已无 UI 调用方（死代码，与测试无关）
