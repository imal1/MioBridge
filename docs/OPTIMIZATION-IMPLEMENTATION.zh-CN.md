# 优化方案实施与验收记录

实现基线：GitHub 远程 `docs/optimization-plan`（8bb36e2），对应 [优化方案](OPTIMIZATION-PLAN.zh-CN.md)。实现分支：`codex/implement-optimization-plan`。本次不调整发布版本号。

## 实现与回归覆盖

| 项目 | 实现 | 主要验证 |
| --- | --- | --- |
| S1 / S2 | 独立管理员/订阅令牌、24h HttpOnly 会话、轮换失效、CSRF 检查、登录限速、新安装默认保护、旧安装显式启用 | core 与 CLI optimization 测试；浏览器真实登录、退出、API 拒绝及二维码 |
| D1 / D2 | 按服务器持久化最后成功来源，72h 上限；发布前检查数量突降，记录 diff、blocked 和显式强制发布；禁用/删除排除基线；旧 raw.txt 也受保护 | core optimization：离线、过期、禁用、旧文件字节保持、强制覆盖 |
| D3 / D4 | config.yaml 单一策略来源，旧 JSON 一次迁移，字段消费者表、配置通知、动态读取及重启标记；固定 clash.yaml | schema 消费者契约、迁移/live edit、旧文件名配置回归 |
| L1 | 每日日志、级别动态读取、保留期、凭据脱敏；采集日志包括服务器 ID、耗时和来源数量 | CLI optimization 日志过滤/脱敏/清理；浏览器四类日志 |
| L2 | 主控 ed25519 密钥、验证后切换、30min 临时凭据、失败重试及凭据补录入口 | CLI optimization：首次失败后重试、独立 composition 使用持久化密钥、0600 权限 |
| L3 | Agent 异步 wrapper 调用、来源及二进制缓存、并发复用；主控 15s 心跳/5min 来源缓存 | Agent 慢 wrapper 期间健康请求 <250ms；主控模拟 1h 轮询 ≤15 次来源请求 |
| L4 | 任务预检快照复用、实际生成阶段回调、发布锁、串行任务 | core 发布/快照测试；订阅任务阶段和 SSE 浏览器验证 |
| L5 | 配置本机 Agent 后跳过旧本机采集；无本机来源不误报警；警告去重 | core 来源契约及生成测试 |
| L6 | croner 五段 Cron、范围/列表/步长、星期 0/7、时区、下次时间及频率预设 | Cron 范围/星期/时区/非法值单测；策略浏览器测试 |
| L7 | 重试/数值草稿、定时开关即时保存且保留其他编辑、真实延迟/缓存/可读状态、50,000 字符预览、部署内置预检和操作过滤 | 前端单测；浏览器策略、预检、运行时、文件预览回归 |
| L8 | 升级联动本机 Agent，串行远端升级提示，卸载 Agent unit，移除本机时提供卸载选择 | CLI maintenance/systemd/release 测试，包括本机系统及旧用户 unit 清理 |
| L9 | 每日 JSONL 指标、GET 不写入、30d 清理和7d后小时降采样；订阅任务启动索引及小时清理 | CLI optimization 指标读写/清理/降采样；任务与指标浏览器验证 |
| L10 | 重名只追加数字后缀，处理后缀冲突 | core 重名/凭据不泄露测试 |
| L11 | 优先 template.user.yaml；保留已有模板，新官方模板写 .new；配置页展示生效路径 | CLI release 模板保持测试；core Mihomo 模板测试 |
| L12 | 临时文件 + fsync + rename，nodes.yaml.bak 恢复，mkdir 跨进程锁 | core 损坏回退、两个独立进程并发写入不丢更新 |
| L13 | 六类真实事件、事件白名单、三次重试、100条投递历史及四类模板 | core Webhook 过滤/重试/Telegram；浏览器 loopback 实际投递/失败/历史 |
| L14 / L15 | 删除 Agent 无效 update；远端不提供 mihomo；POST update / GET 405；旧接口 Deprecation 头和 OpenAPI deprecated | Agent tests、CLI 路由测试、OpenAPI 驱动集成测试、浏览器兼容路径 |
| U1 / U2 | 默认启动、可跳过、PATH/访问地址/防火墙提示、doctor；可重开的首次引导及直接操作 | 安装器/服务测试；完整构建与引导截图 |
| U3 | 预检→安装 Agent→检测/安装内核→纳管→生成；失败复用档案并重试；来源变更30s防抖生成 | 前端自动流程重试单测；服务器创建/部署/监控浏览器用例 |
| U4 | 公网地址、独立令牌链接、本地 QR、客户端导入、下载头、CLI 地址与终端 QR | 浏览器公网地址、二维码、三个文件下载与复制 |
| U5 / U6 | 服务器/代理节点/订阅文件等术语、说明；中文帮助/状态与错误前缀、nodes list、doctor、地址、重启、名称/前缀匹配 | CLI locale/帮助测试；导航与表单浏览器测试 |
| U7 | 自托管部署、Vercel 预览分离、五步上手与五张实测截图、FAQ、中文故障排查及 README 校正 | 文档链接检查，截图来自隔离的真实 HTTP/浏览器登录会话 |
| P2 | 共用状态/按钮/单元格与错误工具；新 API 错误 hint；新增上述回归；handoff zip 移出 Git | 全部类型检查、lint、单测、集成、桌面和移动端浏览器测试 |

## 兼容与验收边界

- 按原方案保留旧配置/部署 API 的弃用窗口，已标记 deprecated，**未提前删除原定 1.4 删除的接口**。新页面使用新配置与部署接口。
- `RedisStateStore` 仍是公开的 core 导出，且已有环境选择/锁协议回归；不能从仓库推断外部用户为零，因此遵守“确认无人使用后移除”的前提，保留兼容。默认自托管路径使用 FileStateStore。
- 旧本机采集适配器仅作为未配置本机 Agent 时的兼容后备；配置本机后禁用重复采集。
- 指标在锁内原子重写当天 JSONL，实现逻辑追加，避免崩溃产生半行；每日样本有界，历史按天清理与降采样。
- `docs/项目界面重设计方案-handoff.zip` 已从版本控制移出，工作区副本在 `/workspace/shared/downloads/miobridge-handoff/`；Git 历史仍可找回原文件。
- 浏览器与 SSH/systemd 测试使用隔离桩和临时目录，不会安装真实远端组件或修改宿主机防火墙。真实公网 VPS “十分钟完成”、各第三方客户端协议拉起、Telegram/Bark/企业微信实际账号投递，需在对应外部环境验收；没有把这些算作已实测通过。

## 最终验证

2026-11-09 的最终本地检查全部通过，共 **691 项**（各套件相加，不重复计算 coverage）。

| 检查 | 结果 |
| --- | --- |
| Core | 109 passed |
| CLI | 215 passed |
| HTTP 集成 | 99 passed |
| Agent | 60 passed |
| 前端单测 | 61 passed |
| Playwright 桌面及移动端 | 147 passed，0 skipped，0 flaky |
| root coverage（Core + CLI + 集成） | 423 passed；行覆盖率 74.04% |
| Core / CLI / 前端 / Agent / 集成 / E2E 类型检查 | 通过 |
| oxlint / git diff --check | 通过 |
| bun install --frozen-lockfile --ignore-scripts | 通过 |
| Linux x64 / arm64 CLI + Agent 发布打包 | 通过；SHA256SUMS 全部通过，压缩包完整性通过 |
| 编译 CLI 中英文帮助、CLI 版本及发布 Agent 版本 | 通过 |
| 文档链接与五张浏览器截图 | 通过 |

浏览器使用系统 Chromium；测试服务仅监听 loopback，外部网络请求由隔离守卫阻断。发布打包在本工作区使用同文件系统的 TMPDIR，避免 Bun 1.2.13 跨挂载点 rename 的 EXDEV 限制。systemd CI 脚本已加入未认证 401 和带订阅令牌下载的检查；真实 systemd 容器验收由仓库既有 GitHub Actions 工作流执行。
