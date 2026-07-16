# MioBridge 完整业务闭环与精简 CLI PRD

> 状态：已批准并实施
> 版本：v2.0
> 日期：2026-07-16
> 产品范围：`@miobridge/core`、Linux CLI、Dashboard、子节点 Agent 安装器

## 1. 背景与目标

旧控制台的问题不只是页面划分，而是很多业务只有一个入口按钮，缺少状态、维护、失败恢复与后续动作。例如“部署”只有一键部署，无法分别处理 Agent、mihomo 和协议核心，也无法看到安装态、运行态、监控态或卸载保留策略。

本轮目标是让 Dashboard 覆盖完整用户需求闭环：

```text
添加节点
  → 管理节点
  → 部署监控程序
  → 维护监控程序
  → 部署 mihomo / 协议核心
  → 管理运行时
  → 生成订阅
  → 维护衍生产物
  → 维护订阅状态
  → 日志诊断
  → API 集成
```

每个环节必须具备：执行入口、真实状态、维护能力、错误结果、恢复路径和明确下一步。同一写操作只能属于一个页面；其他页面只能展示摘要并携带上下文跳转。

## 2. 已锁定边界

- CLI 只保留本机最核心能力、Dashboard 生命周期和 CLI 自维护。
- CLI 不提供节点、部署、Agent、运行时、订阅任务、产物、策略、通知或 task/watch/retry/cancel 命令组。
- Dashboard 承载远端节点和业务任务的完整闭环。
- 主节点使用 `scripts/install.sh`；子节点只安装 Agent 时使用 `scripts/install-agent.sh`。
- 不实施多用户系统；数据结构保留 `role`/`actorRole` 字段，当前固定为 `admin`。
- 不实施新的安全体系增强。
- 不实施版本治理、版本选择或历史回退；升级始终使用当前默认安装来源。
- 不提供批量操作；部署任务每次只接受一个节点和一个组件。
- 不新增自动化浏览器全流程测试。
- mihomo 保持 CLI 转换器模式，不作为常驻服务管理。
- 任务历史默认保留 30 天。

## 3. 产品架构

```text
@miobridge/core
├── 配置 schema、读取、校验和原子保存
├── 来源采集与订阅生成
├── 本机状态
├── 本机日志
└── 当前指标快照

packages/cli
├── 核心无头命令
├── Dashboard 生命周期
├── CLI 安装、升级与卸载
└── Dashboard 后端 Linux 组合与远端适配器

Dashboard
├── 节点与部署
├── Agent / 运行时维护
├── 订阅任务与产物
├── 日志 / 指标 / 配置 / 通知
└── OpenAPI 文档

子节点
└── install-agent.sh → Agent 二进制 + 配置 + systemd
```

框架无关能力必须位于 `packages/core` 并从 `@miobridge/core` 明确导出。SSH、远端部署和 systemd 维护属于 CLI 的 Dashboard 运行时适配层，但不得变成 CLI 用户命令。

## 4. CLI 产品范围

### 4.1 命令清单

```bash
miobridge --help
miobridge --version

miobridge setup [--yes]
miobridge update [--json]
miobridge status [--json]

miobridge config path
miobridge config show [--json]
miobridge config get <field-path> [--json]
miobridge config set <field-path> <value>
miobridge config validate [--file <config.yaml>] [--json]

miobridge logs [--lines <count>] [--level <level>] [--follow]
miobridge metrics [--json]

miobridge dashboard foreground
miobridge dashboard start
miobridge dashboard stop
miobridge dashboard status [--json]

miobridge upgrade
miobridge uninstall [--purge]
```

### 4.2 行为要求

- `update` 同步调用 `MioBridgeCore.updateSubscription()`；partial 结果退出码为 3。
- `status` 只输出本机运行状态、mihomo、三个产物、节点数量、uptime 和构建信息。
- `config get/set` 只接受 Core schema 中存在的字段。
- `config set` 使用 YAML 标量解析；完整校验后通过临时文件和原子替换保存。
- `logs` 默认读取最后 200 行本机控制面日志，支持级别过滤与 follow。
- `metrics` 只输出当前快照，不提供历史查询。
- JSON 模式不得混入进度、说明或装饰字符。
- 退出码：成功 0、业务失败 1、参数错误 2、部分成功 3。
- Dashboard provider 缺失时，核心命令仍可运行。

## 5. Core 能力

`MioBridgeCore` 提供以下稳定能力：

```ts
updateSubscription(): Promise<UpdateResult>
preflightSubscription(): Promise<SubscriptionPreflight>
getStatus(): Promise<StatusInfo>

getConfigPath(): string
getEffectiveConfig(): FullConfig
getConfigValue(path: string): unknown
setConfigValue(path: string, value: unknown): Promise<ConfigApplyResult>
setConfigValues(changes: ConfigChange[]): Promise<ConfigApplyBatchResult>
validateConfig(source?: string): ConfigValidationResult
restoreLastGoodConfig(): Promise<ConfigRestoreResult>

getLocalLogs(options: LocalLogQuery): Promise<LocalLogResult>
followLocalLogs(options: LocalLogQuery): AsyncIterable<LocalLogEntry>
getMetricsSnapshot(): Promise<MetricsSnapshot>
```

配置页、CLI 配置命令及 Dashboard 本机日志/指标必须复用这些能力。配置的多字段保存必须一次完整校验并一次原子替换，不能逐字段造成半生效状态。

## 6. 页面与唯一动作归属

| 页面 | 唯一写操作 | 只读/跳转职责 |
|---|---|---|
| 总览 | 无 | 展示闭环状态、阻塞项、真实指标和下一步 |
| 节点 | 添加、编辑、标签、启停纳管、删除档案 | 跳转部署、Agent、运行时和日志 |
| 部署中心 | 安装、重装、升级、修复、卸载 | 展示任务事件与组件三态 |
| Agent | 启动、停止、重启 | 安装态操作跳转部署中心 |
| 运行时 | 启动、停止、重启、检测、监控配置 | 安装态操作跳转部署中心 |
| 订阅生成 | 预检、创建生成任务、失败重试 | 成功后跳转产物与状态 |
| 衍生输出 | 预览、验证、打开、下载、复制 URL、临时转换 | 缺失时跳转订阅生成 |
| 订阅状态 | 定时策略与健康阈值 | 生成、运行时、产物动作均跳转 |
| 日志 | 筛选、复制、导出 | 定位后跳转唯一维护页 |
| API | 无业务写操作 | 从 OpenAPI 渲染、复制 URL/cURL；写接口不可执行 |
| 配置 | 草稿校验、原子保存、恢复、导入预览、Webhook 测试 | 显示初始/草稿/生效值与待重启 |

页面之间使用 `node`、`component`、`operation`、`task` 等查询参数传递上下文。SOP 导航只显示流程和跳转，不内嵌业务写按钮。

## 7. 节点管理

### 7.1 添加节点

- 输入名称、主机、地域、标签、SSH 用户、端口和凭据。
- 预检包含 DNS、TCP、SSH 认证、sudo/root、Linux、架构、磁盘、systemd 和下载工具。
- 展示并确认 SSH host key。
- 保存时只创建控制面档案，不安装 Agent、mihomo 或协议核心。
- 普通节点接口不返回节点 secret、SSH 密码或私钥。

### 7.2 维护节点

- 支持名称、主机、地域、标签和 SSH 信息编辑。
- 主机变化后清除旧 host key，下次部署前重新预检。
- 支持搜索名称、主机、地域、标签和节点 ID。
- 支持启用、暂停纳管。
- 删除默认只移除控制面档案，不隐式卸载远端程序；存在已记录 Agent 时先引导至部署中心卸载。

## 8. 部署中心

### 8.1 任务输入

每次选择：

- 一个节点；
- 一个组件：Agent、mihomo、sing-box、Xray 或 V2Ray；
- 一个操作：安装、重装、升级、修复或卸载。

卸载必须明确选择保留或删除配置、数据，默认两者都保留。同节点同组件任务互斥；Agent 卸载与该节点任何其他部署任务互斥。

### 8.2 组件状态

每个组件分列展示：

- 安装态：unknown、not_installed、installing、installed、upgrading、uninstalling、failed；
- 运行态：unknown、running、stopped、degraded、error、not_applicable；
- 监控态：not_configured、monitored、unmonitored、error、not_applicable。

mihomo 运行态和监控态为 `not_applicable`。

### 8.3 任务状态与事件

```text
queued
  → prechecking
  → downloading
  → verifying_package
  → installing
  → configuring
  → restarting
  → postchecking
  → done
```

任务持久化保存 taskId、幂等键、actorRole、输入摘要、步骤、状态、进度、消息、错误码、日志、执行前后版本和重试来源。

- queued/prechecking 可取消；进入实际写入后不可取消。
- 失败或取消任务可按原输入重试。
- SSE 事件具有单调递增 eventId，并支持 `Last-Event-ID`。
- 浏览器同时保留轮询降级；页面刷新后按 taskId 恢复。
- Dashboard 重启后 queued 任务继续领取；running 任务标为 interrupted/failed，允许手动重试。
- 历史与事件默认保留 30 天。

### 8.4 操作语义

- 安装：下载、checksum、二进制校验、配置、systemd 和健康验证。
- 重装：覆盖程序并重新验证受管配置。
- 升级：使用当前默认来源，不选择版本，不提供回退。
- 修复：检查二进制、权限、systemd、配置引用、Agent 监控和健康状态。
- 卸载：停止并移除程序与 unit，按所选策略保留配置和数据。

## 9. Agent 与运行时维护

### 9.1 Agent 页面

展示部署状态、版本、端口、uptime、心跳、延迟、健康和最近错误，提供启动、停止、重启和日志入口。安装、重装、升级、修复、卸载全部跳转部署中心。

### 9.2 运行时页面

分别展示 mihomo、sing-box、Xray、V2Ray 的状态、版本、路径、配置路径和来源数量，提供检测、启动、停止、重启和日志。mihomo 明确标识 CLI 模式，不显示服务启动/停止。

### 9.3 监控配置事务

```text
验证核心配置路径可读
  → 写入临时 Agent 配置
  → miobridge-agent --check-config
  → 备份旧配置并原子替换
  → 重启 Agent
  → 验证 /health
  → 更新控制面档案
```

任一步失败必须恢复远端旧配置/服务状态；控制面不得标记为已生效。

## 10. 订阅任务、产物与状态

### 10.1 正式生成任务

正式生成必须创建持久化 `SubscriptionJob`：

```text
collect → parse → deduplicate → encode → convert → validate → publish → backup → done
```

- 零可读来源直接阻断。
- 部分节点离线、来源读取失败或部分产物异常允许 `partial`。
- 保存来源总数、成功数、节点数、警告、错误、备份 ID 和耗时。
- 支持历史查看、失败重试和按上次输入重跑。
- 事件持久化并通过 SSE 推送，刷新后可恢复。

三个正式产物先写入临时文件，验证非空后原子发布：

- `raw.txt`
- `subscription.txt`
- `clash.yaml`

### 10.2 衍生输出

- 展示存在性、有效性、大小、更新时间、年龄和新鲜度。
- 支持站内预览、公共 URL 复制、新窗口打开和下载。
- 支持 Base64、代理 URL、Clash YAML 结构验证。
- 临时转换只返回结果，不覆盖正式产物或任务历史。

### 10.3 订阅状态与策略

默认策略：

```yaml
enabled: false
cron: "0 */6 * * *"
freshnessHours: 24
nodeDropPercent: 30
retryDelaysMinutes: [1, 5, 15]
backupRetention: 30
```

- 新鲜度达到目标的 80% 时预警，超过目标时 stale。
- 相比上次成功输入节点预计下降超过 30% 时记录预警。
- 失败重试计划持久化，Dashboard 重启后继续处理到期记录。
- 检查 Base64、YAML、mihomo、三个公共 URL 和上次正式任务。

## 11. 配置、日志、指标与通知

### 11.1 配置

- Core schema 是唯一可修改字段清单。
- 展示初始值、草稿值、生效值、字段 diff 和是否需要重启。
- 保存前完整校验，多字段一次原子保存。
- 保留 `.last-good`，支持恢复；恢复前的当前值保存为 `.pre-restore`。
- 支持脱敏 YAML 导出。
- 导入只做解析、校验和差异预览，不直接覆盖。

### 11.2 日志

统一 `/api/logs` 支持四种来源：

- 控制面本机日志；
- 子节点 Agent 日志；
- 部署任务事件日志；
- 订阅任务事件日志。

支持 source、node、component、taskId、file、level、from、to 和关键词筛选，并支持复制、导出与自动刷新。

### 11.3 指标

CLI `metrics` 只输出当前快照；Dashboard `/api/metrics` 提供 24 小时、7 天和 30 天窗口：

- 部署成功率与平均耗时；
- Agent 在线率；
- 来源成功率；
- 订阅任务成功率；
- 产物平均与最大年龄；
- 当前节点、来源、代理、mihomo 和产物快照。

### 11.4 通知

通知只在 Dashboard 配置和 API 中提供普通 Webhook：启用状态、URL、事件列表、测试发送和最近投递结果。CLI 不增加通知命令。

## 12. HTTP API

规范端点：

```text
/api/cluster/nodes/:id
/api/cluster/components/*
/api/deployments/*
/api/subscription-jobs/*
/api/artifacts/*
/api/subscription-policy
/api/config/*
/api/logs
/api/diagnostics
/api/metrics
/api/notifications/*
/api/openapi.json
```

通用规则：

- 规范 API 使用 `ApiEnvelope<T>`、requestId 和固定 `role: admin`。
- 错误包含 code、message 和 retryable。
- 长任务返回 HTTP 202 与 taskId/jobId。
- 写请求接受幂等键。
- SSE eventId 持久化递增。
- 旧 `/api/cluster/*` 与 `GET /api/update` 保持兼容。
- `/subscription.txt`、`/clash.yaml`、`/raw.txt`、`/health` 保持公共兼容。
- API 页面从 `/api/openapi.json` 动态渲染；写接口不显示执行按钮。

状态目录：

```text
deployment-tasks/
deployment-events/
subscription-jobs/
subscription-events/
subscription-retries/
artifact-state/
metrics/
notifications/
```

## 13. 子节点 Agent 手动安装

部署中心 Agent 卡片提供 SSH 自动部署和手动 Shell 部署。手动入口展示节点 ID、名称、端口、配置下载、安装命令和安装后健康检查。

```http
GET /api/deployments/agent/manual-config?nodeId=<id>
```

响应以 attachment 下载 `agent.yaml`；只有该专用端点包含 Agent secret。

使用方式：

```bash
scp agent.yaml root@child:/tmp/miobridge-agent.yaml

curl -fsSL \
  https://github.com/imal1/miobridge/releases/latest/download/install-agent.sh \
  -o /tmp/install-agent.sh

sudo sh /tmp/install-agent.sh \
  --config /tmp/miobridge-agent.yaml
```

安装器支持：

```bash
install-agent.sh \
  [--config <agent.yaml>] \
  [--version <version>] \
  [--repository <owner/repo>] \
  [--base-url <release-url>] \
  [--install-dir <dir>] \
  [--config-dir <dir>]
```

以及独立参数模式：

```bash
sudo sh install-agent.sh \
  --node-id <id> \
  --node-name <name> \
  --secret-file <file> \
  [--kernel sing-box:/etc/sing-box/config.json] \
  [--kernel xray:/etc/xray/config.json] \
  [--kernel v2ray:/etc/v2ray/config.json] \
  [--port 3001]
```

- 不接受明文 `--secret`。
- 首次安装必须提供配置；再次执行可保留已有配置。
- 无 kernel 时生成 `kernels: []`。
- x86_64/amd64 映射 x64，aarch64/arm64 映射 arm64。
- 下载 Agent gzip 和 `SHA256SUMS`，执行 checksum、`--version`、`--check-config`。
- 原子替换二进制、配置和 systemd unit；失败恢复旧文件。
- unit 显式使用 `--config /etc/miobridge-agent/agent.yaml`。
- 验证 systemd active 与本机 `/health`。
- 只安装 Agent，不安装 CLI、Dashboard、Bun、mihomo 或协议核心。

Agent 参数：

```bash
miobridge-agent --version
miobridge-agent --config <path>
miobridge-agent --check-config <path>
```

命令行路径优先于 `MIOBRIDGE_AGENT_CONFIG`；`--check-config` 校验后退出且不监听端口。

## 14. 验收标准

### CLI

- 锁定命令的文本、JSON、参数和退出码测试通过。
- help 不出现排除命令组。
- Core schema 限制 get/set；无效保存不改变原文件。
- logs 默认行数、级别和 follow 正确。
- metrics 只输出快照。
- Dashboard provider 缺失不影响核心命令。

### Dashboard 与 API

- 11 页动作归属唯一，无重复业务写按钮。
- 五组件均具备五种部署操作、三态、事件、冲突、取消、重试和恢复。
- Agent/运行时日常维护与部署操作分离。
- 监控配置事务失败不更新控制面并恢复远端。
- SubscriptionJob、partial、历史、策略、重试和产物验证可用。
- 配置 diff/校验/原子保存/恢复/导入预览可用。
- 四来源日志、三档指标和 Webhook 测试可用。
- OpenAPI 动态渲染，写接口不可在文档页执行。
- 桌面与移动布局保持现有 Botanical Garden 设计语言。

### Agent 与 Release

- Agent 三种参数行为及退出码通过测试。
- 安装器覆盖架构、最新/指定版本、镜像、checksum 缺失/错误、缺少配置、空 kernels、配置失败、systemd 失败回滚和重复执行。
- Release 输出包含 x64/arm64 Agent gzip、`install-agent.sh` 和 `SHA256SUMS` 条目。
- 安装脚本通过 POSIX `sh` 语法检查。

### 工程回归

- frontend、core、CLI、Agent 的单元/组件测试和 typecheck 全部通过。
- frontend lint、生产构建、release 打包测试、shell 检查和 `git diff --check` 通过。
- 不新增自动化浏览器全流程测试。
