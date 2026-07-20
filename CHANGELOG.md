# Changelog

本文档记录 MioBridge 的重要变更。版本号遵循语义化版本规范。

## [1.2.2] — 2026-07-19

### Fixed

- 选择本机节点安装时，默认安装同版本、校验过的 Agent，并将 sing-box、Xray、
  V2Ray 三种内核写入本机监控配置；旧的 sing-box-only 本机档案会自动补齐。
- 本机节点不再从节点、部署、Agent、运行时、订阅、日志与总览流程中被过滤；
  部署任务通过本机命令传输执行，不再要求回环 SSH 凭据。
- Agent 按内核、按配置文件独立提取 233boy `url` 来源，单个损坏配置不再丢弃
  同节点的其他内核；多子节点、多内核来源会整体进入三项正式订阅产物。
- Clash 转换保留 VLESS Reality/flow、WebSocket/gRPC、SNI 与 VMess 传输字段；
  默认规则补齐 LAN/IPv6/CN GEOIP 与 `no-resolve`，移除 Apple `17/8` 强制直连。

## [1.2.1] — 2026-07-19

### Added

- 本机节点默认配置：首次安装时把当前服务器创建为名为「本机节点」的普通子节点
  档案（`install.sh` 默认开启，`--no-local-node` 跳过）；`miobridge setup`
  支持 `--local-node`/`--no-local-node`，新增 `miobridge nodes configure`
  可随时启用或移除。它与手动添加的节点行为完全一致，出现在 Dashboard 节点
  列表并走相同的 Agent 部署与监控流程。

### Changed

- 移除全局流程条导航（WorkflowRail）：模块串联改由各页面内带上下文的深链
  完成（节点卡片直达部署、订阅来源就绪度按缺项给出维护入口、生成成功后浮现
  产物与状态入口等），全局导航由侧边栏承担。

## [1.2.0] — 2026-07-19

对应路线图 v1.2「在线配置管理」里程碑；同批工作也完成了 v1.6 的全部验收，
以及 v1.5、v1.8 的大部分内容（v1.1 按计划推迟，版本号跳过）。

### Added

- 在线配置管理：Schema 化字段草稿与差异预览、保存前完整校验、单次原子写入、
  需重启字段的明确标记；配置导入（只预览差异）、脱敏导出、`/api/config/restore`
  一键恢复 last-good。
- 动态 OpenAPI 3.1 文档（`/api/openapi.json`）与 API 文档页；统一的成功/错误
  envelope、请求校验、`X-Request-ID` 关联与写接口幂等键。
- `/api/metrics` 指标端点：24h/7d/30d 窗口、历史快照与部署/来源/订阅/产物摘要；
  总览页指标趋势卡片。
- Webhook 通知：测试投递、非 2xx 失败可见、持久化投递历史。
- 四来源日志页：按级别、时间与关键字过滤，请求失败保留上一次成功结果。
- 订阅任务：SSE 实时进度（支持 `Last-Event-ID` 断线续传）、历史恢复、按原输入
  重试、部分成功的来源统计与警告。
- 145 条 Playwright E2E 用例作为 CI 门禁，覆盖壳层、节点、部署、订阅、配置、
  可观测与 API 边界。

### Fixed

- 关闭 E2E 套件记录在案的全部 21 项产品缺口，含跨进程保留「最近错误」、
  内核检测如实上报已验证的二进制路径。
- 编辑私钥认证节点且不更换凭据时，不再被静默翻转为密码认证。
- 内核状态/检测响应出现良性未知字段时不再整体失效；凭据形状的字段仍硬拒。
- 总览页：切换指标窗口时丢弃过期响应，避免图表与按钮高亮不一致；刷新失败
  给出可见错误并在恢复后清除。
- HTTP adapter 对超大请求体排空后按规范返回 413 envelope，不再截断连接。

### Changed

- 版本号统一以 `CLI_VERSION` 为唯一来源：OpenAPI info、Agent 发布件解析与
  组合层默认值不再各自硬编码。

## [1.0.0] — 2026-07-15

### Added

- 自包含 Linux CLI，提供 `setup`、`update`、`status`、`dashboard`、`upgrade` 和 `uninstall` 命令。
- Linux x64/arm64 发布产物、SHA-256 校验、原子安装和原子自升级。
- CLI 托管的 Vite dashboard 与 `/subscription.txt`、`/clash.yaml`、`/raw.txt`、`/health` 兼容地址。
- 用户级 systemd dashboard 生命周期，以及独立登录后的服务重连支持。
- `mihomo` 必需内核的固定版本、固定摘要安装；`sing-box` 保持可选发现。
- 主节点订阅生成与远程 Agent 节点聚合。
- 与 CLI 同版本发布的 Linux x64/arm64 Agent 二进制及远端摘要校验安装。

### Changed

- 自托管运行时改为 CLI-first 分层：`miobridge` 负责管理，外部内核作为独立二进制运行。
- 子节点 Agent 改为下载预编译 Release 制品，不再安装 Bun 或现场编译源码。
- `scripts/install.sh` 成为唯一 bootstrap Shell；安装后不再依赖管理脚本树或源码目录。
- 前端统一为 Vite SPA，并由 CLI 的单进程 HTTP 服务托管。

### Removed

- 旧 Subconverter 发布线及其部署约定。
- `manage.sh` 和安装后的 Shell 生命周期入口。
