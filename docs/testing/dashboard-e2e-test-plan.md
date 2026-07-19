# Dashboard Playwright 全量端测用例

## 目标与判定

本计划验证构建后的 Vite Dashboard 经由真实 CLI HTTP Server、真实路由处理器和隔离的有状态依赖端口完成全部用户 SOP。浏览器交互与 Playwright `APIRequestContext` 共同覆盖 UI、HTTP 契约、任务状态恢复及兼容 URL。

- P0：主 SOP、写操作安全、产物与配置原子性。任一失败即不通过。
- P1：错误恢复、历史任务、日志诊断、移动端与契约边界。
- P2：展示完整性、复制、下载和辅助筛选。
- 通过条件：用例有可复现结果；P0/P1 无未解释跳过；失败必须在报告中包含请求边界及截图/trace。
- 已确认但尚未修复的产品缺口使用 Playwright `test.fail` 精确备案，不使用 `skip`/`fixme`；缺口意外通过会让测试失败，以提醒移除过期备案。

## 工程隔离

- 独立 workspace：`packages/e2e`，不把浏览器依赖放进 frontend 或生产 CLI。
- 服务只监听 `127.0.0.1:4173`，`reuseExistingServer=false`，不复用开发端口或 Tailscale 地址。
- 每个用例前 reset 确定性内存状态；SSH、Agent、systemd、远端内核由有状态端口替身执行。
- 浏览器拒绝非 base URL 请求；服务端 `fetch` 只允许本次 loopback webhook。
- 测试主机均使用 `.invalid`，不会读取真实 SSH 凭据、节点、Redis/KV 或 `~/.config/miobridge`。
- 生成物仅写入 `packages/e2e/.artifacts`，包括 HTML、JSON、JUnit、截图、视频和 trace。

## 数据夹具

F0–F13 是可组合的逻辑数据档案：每例从 `baseline`（或 `empty`）重置，再通过隔离 control flags 构造故障、终态和边界；它们不是 14 个会写入生产配置的命名环境。

| ID | 数据集 | 用途 |
|---|---|---|
| F0 | empty | 无远端来源、无任务、无产物 |
| F1 | preflight-ok | 九项 SSH 检查、固定 host key、x86_64 |
| F2 | preflight-fail | DNS/TCP/SSH/权限等单点失败 |
| F3 | node-empty | 未部署 Agent 的远端节点 |
| F4 | node-ready | Agent running；sing-box 已安装、已监控、可读 |
| F5 | runtime-failure | Agent/内核停止、离线或操作失败 |
| F6 | deployments | queued/running/success/error/cancelled 及事件 |
| F7 | subscriptions | ready/blocked 与五种任务终态 |
| F8 | artifacts | fresh/missing/invalid/stale/截断预览 |
| F9 | policy | 默认及自定义订阅策略 |
| F10 | config | 全 schema 类型、last-good、通知历史 |
| F11 | logs | control/agent/deployment/subscription 四来源 |
| F12 | metrics | 24h/7d/30d 可区分样本 |
| F13 | openapi | 动态完整 OpenAPI 契约 |

## SOP 覆盖矩阵

| ID | 优先级 | 功能与步骤 | 成功断言 | 失败/边界断言 | 自动化位置 |
|---|---|---|---|---|---|
| E00 | P1 | 直达 11 路由、侧栏、主题、`/actions`、移动抽屉 | 唯一 H1、active nav、主题持久化、重定向正确 | API 404 不被 SPA fallback 吞掉；移动无溢出 | `shell-overview.spec.ts`, `responsive.spec.ts` |
| E01 | P1 | 总览刷新、三档指标、四步导航 | readiness/产物/指标正确；24h/7d/30d 均请求 | 总览导航不产生写请求 | `shell-overview.spec.ts` |
| E02 | P0 | 密码/私钥添加节点，先预检再保存 | 九项检查、host key、payload、仅建档 | 预检失败、重复主机、端口边界、表单保留 | `nodes-deploy.spec.ts` |
| E03 | P0 | 搜索/筛选/编辑/启停/删除 | PATCH 后刷新；未部署可删除 | 已部署禁止直接删除；业务失败不伪成功；无 secret | `nodes-deploy.spec.ts` |
| E04 | P0 | 5 组件 × 5 操作创建部署任务 | 25 种请求、幂等键、保留策略、202 | 无节点/预检/冲突/API 失败 | `nodes-deploy.spec.ts` |
| E05 | P0 | 部署 queued→done、取消、重试、刷新恢复、事件 | 进度单调、状态/版本/日志上下文正确 | 晚取消、未知任务、失败重试、事件续传 | `nodes-deploy.spec.ts` |
| E06 | P1 | Agent 手动 Shell 部署 | YAML 下载头、内容、复制、完成健康检查 | 无节点禁用；只安装 Agent | `nodes-deploy.spec.ts` |
| E07 | P0 | Agent 启动/停止/重启/健康/维护链接 | 状态条件按钮、payload、刷新和 toast | 未安装恢复路径；业务失败保持旧状态 | `agents-runtimes.spec.ts` |
| E08 | P0 | 三内核检测与 start/stop/restart | 严格三项、版本/路径/来源、mihomo CLI 模式 | Agent 不可用、检测/操作错误 | `agents-runtimes.spec.ts` |
| E09 | P0 | 编辑并保存监控事务 | 一次原子 PUT、重新检测、自定义路径保留 | 失败不改变旧配置 | `agents-runtimes.spec.ts` |
| E10 | P0 | 订阅 blocked/partial/ready 预检与创建 | ready 才可创建；幂等键；活动任务防重 | 零来源、API/创建失败及恢复链接 | `subscription-config-observability.spec.ts` |
| E11 | P0 | 订阅历史、SSE、失败/partial 重试 | 步骤、进度、来源数、刷新恢复、下一步 | 重试失败与 interrupted 恢复 | `subscription-config-observability.spec.ts` |
| E12 | P0 | 三产物验证/预览/复制/打开/下载 | 状态、大小、新鲜度、URL 和下载头 | missing/invalid/stale；validate 失败不得报成功 | `subscription-config-observability.spec.ts` |
| E13 | P1 | 临时转换 modal | 转换/复制/清空/关闭，且不写正式产物 | 空输入与非法内容 | `subscription-config-observability.spec.ts` |
| E14 | P0 | 订阅健康检查与策略草稿 | 保存回填、dirty、产物/mihomo/任务状态 | 非法 cron/数值、PUT 失败保留草稿 | `subscription-config-observability.spec.ts` |
| E15 | P1 | 四来源日志、组合过滤、自动刷新、复制/导出 | 查询参数、行数、文件名和内容 | 缺 node/task 阻断；读取失败保留旧结果 | `subscription-config-observability.spec.ts` |
| E16 | P0 | schema 驱动配置、diff、校验、原子 PATCH | 一次 `changes[]`；restartRequired；放弃 | 校验/PATCH 失败不更新 effective | `subscription-config-observability.spec.ts`, `config-api-boundaries.spec.ts` |
| E17 | P0 | 导入预览、脱敏导出、恢复 last-good | 导入只预览；导出无 secret；恢复刷新 | 非法 YAML、取消/恢复失败 | `subscription-config-observability.spec.ts`, `config-api-boundaries.spec.ts` |
| E18 | P1 | webhook 测试和历史 | 200/500 状态、事件与时间持久化 | 未启用、网络失败、空历史 | `subscription-config-observability.spec.ts`, `config-api-boundaries.spec.ts` |
| E19 | P1 | 动态 OpenAPI 展开/复制/打开 GET | 端点来自契约；写操作只复制不执行 | 契约失败/非法/空 paths 可恢复 | `subscription-config-observability.spec.ts`, `config-api-boundaries.spec.ts` |
| E20 | P0 | 安全、HTTP、兼容 URL 和完整串行主 SOP | request-id/envelope/role；幂等；三兼容文件 | 1 MiB、JSON、404/405；普通响应不泄密 | `full-sop-journey.spec.ts`, contract specs |

## 完整串行验收链

同一隔离状态中执行并验证：

`添加节点 → 部署 Agent → Agent 健康 → 部署协议核心 → 配置监控 → 订阅预检与生成 → 校验三产物 → 保存策略 → 查询任务日志 → 读取动态 OpenAPI`

该链使用真实 Dashboard HTTP 路由贯穿状态，远程副作用由确定性端口替身完成；各功能页的可访问交互由对应分项 spec 单独覆盖。

## 报告输出

- 人类可读结论：`docs/testing/dashboard-e2e-report.md`
- HTML：`packages/e2e/.artifacts/html/index.html`
- 机器结果：`results.json`、`junit.xml`
- 失败证据：每个失败用例的 screenshot、video、trace。

## 可执行入口

- 完整串行 SOP 主链：`bun run e2e:sop`
- 最小服务边界 smoke：`bun run e2e:smoke`
- 全部 E00–E20 用例：`bun run e2e`
