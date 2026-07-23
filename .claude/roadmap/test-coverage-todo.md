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

## 已知不修

- cli ~21 个 Windows 失败 — CI 是 Linux，不修
