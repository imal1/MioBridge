# MioBridge 优化方案：逻辑缺陷、日常易用性与上手门槛

> 状态：待评审
> 基线：v1.2.23（`dcaa3dc`），文中行号以该版本为准
> 范围：`packages/core`、`packages/cli`、`packages/frontend`、`agent`、`scripts/`、文档

## 0. 背景与目标

MioBridge 已能稳定自用：主控生成 `raw.txt`、`subscription.txt` 和 `clash.yaml`，子节点跑
Agent 和协议内核。本次通读代码后，问题分成三类：

1. **会让订阅变坏或带来风险的缺陷**：子节点短暂失联时订阅会少节点，控制面没有任何认证。
2. **天天用时别扭的逻辑**：设置改了不生效，root 密码要反复输入，任务总显示「部分成功」，日志页是空的。
3. **门槛高**：概念多、步骤分散、安装完不知道下一步做什么，只有作者自己用得明白。

目标：

- **正确**：子节点抖动不会让客户端少节点；保存成功的配置一定生效。
- **省心**：日常操作（加节点、升级、重试、看日志）一次完成，不用反复输入凭据或跳转多个页面。
- **可交接**：新用户从 `curl | bash` 到在客户端导入订阅，**10 分钟内**完成，不用读源码。
- **兼容**：保持 `/subscription.txt`、`/clash.yaml`、`/raw.txt`、`/health` 路径不变。

---

## 1. 问题总览

| ID | 级别 | 类别 | 问题摘要 |
| --- | --- | --- | --- |
| S1 | P0 | 安全 | Dashboard/API 默认监听 `0.0.0.0` 且无任何认证，可远程部署、读取 Agent 密钥、改配置 |
| S2 | P0 | 安全 | 订阅 URL 无令牌，任何知道 IP:端口的人可拿到全部代理凭据 |
| D1 | P0 | 数据正确性 | 子节点短暂失联时，订阅仍被「缩水覆盖」，客户端自动更新后节点消失 |
| D2 | P0 | 数据正确性 | 「节点突降阈值」只追加警告，不拦截发布 |
| D3 | P0 | 数据正确性 | 配置页约 20 个字段保存后没有任何代码读取；订阅策略有两套数据源 |
| D4 | P0 | 数据正确性 | 修改 `subscription.clash_filename` 后，`/clash.yaml` 会永远返回旧文件 |
| L1 | P1 | 逻辑 | 控制面日志永远为空（core 注入的是 `silentLogger`，没有任何地方写 `*.log`） |
| L2 | P1 | 逻辑 | root SSH 凭据在每个任务结束后清除：重试必然失败，CLI `nodes diagnose` 用不了 |
| L3 | P1 | 性能/稳定 | Agent `/api/urls` 全同步 `execFileSync`，加上仪表盘每 4~5 秒扇出一次，可能导致心跳误报 |
| L4 | P1 | 逻辑 | 一次订阅生成会把所有节点采集 3 遍；进度条是假的 |
| L5 | P1 | 逻辑 | 主控没有 233boy sing-box 时，每次任务都是「部分成功」；本机来源被采集两次，命名还会错 |
| L6 | P1 | 逻辑 | Cron 只支持 `*`、`*/n` 和逗号列表；`9-18` 这类写法能保存但永远不触发；时区不明确 |
| L7 | P1 | 前端 | 「重试间隔」输入框无法正常输入第三个值；定时开关不点保存就丢；延迟列永远是 `—` |
| L8 | P1 | 生命周期 | `upgrade` 不升级本机 Agent；`uninstall --purge` 不删本机 Agent；子节点 Agent 版本落后没有提示 |
| L9 | P1 | 存储 | `metrics/*.json` 无限增长且每次 GET 都写一个；任务列表每次全量读盘 |
| L10 | P1 | 输出 | Clash 重名时把**完整代理 URL（含 UUID/密码）**拼进节点名 |
| L11 | P1 | 输出 | `template.yaml` 每次升级都被覆盖，用户自定义规则会被静默清掉 |
| L12 | P1 | 存储 | `FileStateStore.set` 不是原子写，进程之间也没有锁，`nodes.yaml` 可能被写坏 |
| L13 | P2 | 功能 | Webhook 只能发 test 事件，失败/离线都不会通知 |
| L14 | P2 | 死代码 | Agent `/api/update` 调用不存在的 `mihomo convert`；子节点可「部署 mihomo」但完全不需要 |
| L15 | P2 | API | `GET /api/update` 有副作用；新旧两套部署/配置 API 并存 |
| U1 | P1 | 门槛 | 安装脚本结束后不启动 Dashboard、不给访问地址、不处理 PATH |
| U2 | P1 | 门槛 | 首次打开没有引导；「就绪检查」只有文字没有操作按钮 |
| U3 | P1 | 门槛 | 加一个子节点要跨 4 个标签页、预检 2 次、手动选组件和操作 |
| U4 | P1 | 门槛 | 「订阅」页没有订阅地址；没有二维码和客户端导入；复制的地址可能是 `localhost` |
| U5 | P1 | 门槛 | 「节点」一词同时指服务器和代理条目，加上内核、来源、产物、Agent 这些概念，新人看不懂 |
| U6 | P1 | 门槛 | CLI 中英混杂；没有 `nodes list`，诊断却要 UUID；`dashboard start` 不输出地址 |
| U7 | P1 | 门槛 | 文档：`docs/DEPLOYMENT.md` 讲的是 Vercel；README 描述和现状不符；缺少快速上手和 FAQ |

---

## 2. P0：安全与数据正确性（先做）

### S1/S2 控制面与订阅无认证

**现状**

- `packages/cli/src/dashboard/foreground.ts:38` 和 `packages/cli/src/dashboard/systemd.ts:88` 默认监听
  `0.0.0.0:3000`，`packages/cli/src/dashboard/server/nodeServer.ts` 不做任何鉴权。
- 能访问端口的任何人都可以：
  - 调 `/api/deployments` 在子节点上执行部署；
  - 通过 `/api/deployments/agent/manual-config?nodeId=`（`applicationRoutes.ts:41`）下载含 HMAC
    `secret` 的 Agent 配置；
  - 修改 `/api/config`；
  - 用 `/api/cluster/nodes` 删除节点。
- `/clash.yaml` 等产物返回全部代理凭据，路径固定、可被扫描。

roadmap 把 Auth 放在 Deferred 里，理由是单用户。但服务通常跑在公网 VPS 上，「单用户」不等于「只有自己访问得到」。

**方案**（不做多用户，只做单管理员令牌）

1. 安装时生成 `~/.config/miobridge/auth.yaml`，包含：
   - `admin_token`：32 字节随机值，用于登录 Dashboard；
   - `subscription_token`：独立随机值，只用于订阅。
2. Dashboard 增加登录页，用 `admin_token` 换取 HttpOnly + SameSite=Strict Cookie。所有 `/api/*` 都要求
   Cookie，`/health` 除外。
3. 兼容 URL 保持原路径，增加令牌校验：`/clash.yaml?token=<subscription_token>`。
   - 新安装默认开启校验。
   - 已有安装升级后默认关闭校验（避免客户端断订阅），Dashboard 顶部常驻黄条，提示「订阅未加令牌，
     点此开启并复制新地址」。
4. CLI 新增：
   - `miobridge auth show`：打印 Dashboard 地址和令牌；
   - `miobridge auth rotate [--subscription]`：轮换令牌。
5. 兼容 URL 读文件失败时只返回 `404 Not Found`，不要把含绝对路径的 `ENOENT` 原文回给客户端
   （`compatRoutes.ts` 的 catch 分支）。

**验收**：未登录访问 `/api/*` 返回 401；未带令牌访问 `/clash.yaml` 返回 401/404（开启后）；
Agent 配置下载必须登录。

---

### D1/D2 子节点抖动导致订阅「缩水覆盖」

**现状**

- `NodeAggregationService.collectSources` 失败时返回 `sources: []`（`nodeAggregationService.ts:148`）。
- `ArtifactService.updateSubscription` 只要总数大于 0 就照常发布（`artifactService.ts:92`），把少了一整台服务器的结果写成正式产物。
- 客户端（Clash Verge 等）定时拉取后，这台服务器的节点就消失了。
- `SubscriptionJobService.start` 算出了节点突降（`subscriptionJobs.ts:93`），但只放进 `warnings`，
  照样发布。
- 订阅页对离线节点显示「缓存」标签（`subscription.tsx:247`），但代码里**根本没有来源缓存**，
  这个标签会误导用户。

**方案**

1. **每台服务器保留最后一次成功的来源快照**：每次采集成功写入
   `node-sources/<nodeId>.json`（内容为 `{ sources, collectedAt, agentVersion }`）。
2. 采集失败时，只要该节点仍是启用状态，且快照未超过 `subscription.stale_source_max_hours`
   （默认 72 小时），就使用快照。任务标记为 `partial`，并写明「东京-1 使用 3 小时前的缓存」。
   这样「缓存」标签就名副其实了。
3. **突降保护改为拦截**：用缓存补齐后，节点数仍比上次成功结果下降超过 `node_drop_percent` 时，
   **不发布**，保留现有产物。任务进入新状态 `blocked`，UI 提供「查看差异 / 强制发布」。
   - 定时任务永远不自动强制发布。
   - 手动点击时二次确认。
4. 发布前做一次 diff，记录新增、删除的代理名称，写入任务详情，方便排查「哪台服务器少了」。
5. 暂停（disabled）的节点视为主动移除，不走缓存，也不触发拦截。

**验收**：停掉任意一台子节点的 Agent 1 小时，期间定时生成照常进行，客户端拉取的节点数不变，UI
标注缓存来源；删除一台服务器的 Agent 配置（真实减少）时，任务停在 `blocked`，手动确认后才发布。

---

### D3/D4 配置字段写了不生效，订阅策略两套数据源

**现状**

`packages/core/src/config/configValidation.ts` 的 `CONFIG_FIELDS` 在配置页逐个渲染，保存后提示
「已保存并生效」。实际检索发现，下列字段**除类型定义外没有任何消费者**：

| 字段 | 实际情况 |
| --- | --- |
| `app.public_base_url`、`app.log_level`、`app.timezone` | 无人读取 |
| `subscription.enabled/cron/freshness_hours/node_drop_percent/retry_delays_minutes/backup_retention` | 订阅策略实际读写 `subscription-policy.json`（`subscriptionJobs.ts` 的 `policy()`），配置页改了无效 |
| `deployment.concurrency/ssh_timeout_ms/task_timeout_ms/task_retention_days` | 无人读取 |
| `logs.level`、`logs.task_retention_days` | 无人读取 |
| `binaries.xray_path`、`binaries.v2ray_path` | 无人读取 |
| `notifications.webhook.events` | 无人读取（见 L13） |
| `subscription.clash_filename` | **有害**：`ArtifactService` 按新文件名写（`configService.ts:86`），但 `/clash.yaml` 路由（`compatRoutes.ts:15`）和产物状态都固定读 `clash.yaml`，客户端会一直拿到旧文件 |

另外，`MioBridgeCore` 构造时只读取一次配置并传给各服务，所以很多标着 `restartRequired: false` 的字段其实也要重启才会生效。

**方案**

1. **单一数据源**：订阅策略改为读写 `config.yaml` 的 `subscription.*`。启动时如果存在
   `subscription-policy.json`，一次性迁移并改名为 `.migrated`。订阅页和配置页编辑的是同一份数据。
2. **字段要么实现，要么删除**：
   - 实现：`app.public_base_url`（用于复制链接和二维码，见 U4）、`app.timezone`（Cron 与界面时间）、
     `logs.level`（见 L1）、`deployment.ssh_timeout_ms/task_timeout_ms/task_retention_days`、
     `notifications.webhook.events`。
   - 删除：`subscription.clash_filename`（兼容路径必须固定）、`binaries.xray_path/v2ray_path`（主控不运行这两个内核）、
     `deployment.concurrency`（PRD 规定不做批量）。
3. **契约测试**：为 `CONFIG_FIELDS` 建立「字段 → 消费者」登记表，单测断言每个字段都有登记，并且修改后经由
   `ConfigService` 的变更通知真正生效。新增字段不登记就无法通过 CI。
4. `restartRequired` 如实标注；能热更新的字段通过 `ConfigService` 发出变更事件，不再依赖构造时快照。

**验收**：配置页每个字段修改后都有可观测的效果，或者该字段已不在页面上；订阅页和配置页显示的策略始终一致。

---

## 3. P1：日常使用中的逻辑问题

### L1 控制面日志永远为空

- `packages/cli/src/composition.ts:44,102`：没有传 logger 时使用 `silentLogger`，`main.ts:19` 也没传。
  `ArtifactService`、`SingBoxAdapter` 等的 warn/error 全部被丢弃。
- `LocalLogService` 读取 `logDir/*.log`，但整个仓库没有任何代码写这些文件。所以日志页「控制面」来源和
  `miobridge logs` 永远是空的。
- Fastify 日志只进 journald，Web 端看不到。

**方案**：CLI 组合根注入一个按天滚动的文件 logger，写到
`~/.config/miobridge/logs/miobridge-YYYY-MM-DD.log`，格式为 JSON Lines，默认保留 14 天，遵守 `logs.level`。
Fastify 的请求日志降为 debug 并写入同一文件。订阅任务的「日志」不再显示事件 JSON 原文，改为人能读的时间线，
内容包括来源、警告、差异和耗时。

### L2 root SSH 凭据是一次性的

- 添加 root 节点时只把凭据放在内存（`nodeDependencies.ts:81`），任何部署任务结束都会清除
  （`sshDeployment.ts:523,713`）。
- 后果：
  - 先装 Agent，再装 sing-box，会报「节点 SSH 凭据不存在」；
  - 失败任务点「重试」**必然失败**（`retryComponentDeployment` 不带凭据）；
  - Dashboard 重启后所有 root 节点都无法维护；
  - CLI `miobridge nodes diagnose/repair` 在独立进程运行，对 root 节点永远没有凭据。
- 绝大多数 VPS 默认只有 root，这是日常最高频的摩擦。

**方案**（按优先级）

1. **主控专用 SSH 密钥**：首次运行时生成 `~/.config/miobridge/ssh/id_ed25519`。添加节点时用一次性 root 密码
   把公钥写进 `authorized_keys`；也可以展示一行命令让用户自己粘贴。之后节点档案只引用密钥，**不存储密码**，
   也不再需要重复输入。删除节点时可选「同时移除公钥」。
2. **Agent 部署后的维护尽量不走 SSH**：重启、配置更新、内核纳管等改走 Agent HMAC API。这与
   roadmap 中「Agent Identity and Privilege Separation」一致，SSH 只用于首次引导和 Agent 无法自愈的场景。
3. **过渡期**：一次性凭据的 TTL 从「下一个任务」改为「30 分钟或 Dashboard 进程生命周期」。重试或部署时如果缺少凭据，
   前端弹出凭据输入框，不再直接失败。

### L3 Agent 来源采集阻塞事件循环，仪表盘轮询放大负载

- `agent/src/handlers/urls.ts:73,280`：每次 `/api/urls` 都会同步执行最多 3 次 `<kernel> help`
  （扫 PATH），再对每个配置文件同步执行 `<kernel> url <name>`（233boy 的 bash 包装脚本）。执行期间 Agent
  的事件循环被阻塞，同一时刻的 `/health` 只能排队。
- 主控 `computeClusterStatus`（`nodeAggregationService.ts:103`）每次刷新都并发调用 `/health` 和
  `/api/urls`。缓存 TTL 是 2 秒，节点页每 4 秒轮询、订阅页每 5 秒轮询，所以**只要页面开着，每台子节点约每 4 秒被完整采集一次**。
  订阅页还会每 30 秒跑一次完整预检。
- 低配节点上，这正好会造成「来源解析慢 → `/health` 超时 → 显示波动」。1.2.22 把心跳改成
  `/health` 只解决了一半。

**方案**

1. Agent 端：
   - 内核二进制在启动时探测，之后每 5 分钟重探一次；
   - 来源结果按「配置文件路径 + mtime + size」缓存；
   - 改用异步 `execFile`；
   - `/api/urls` 立即返回缓存，过期时在后台刷新，响应里带上 `collectedAt`。
2. 主控端：把**心跳**（每 15 秒，只调 `/health`）和**来源采集**（每 5 分钟、手动触发、生成订阅时）拆开。
   集群状态接口只读缓存，不在请求链路上扇出。
3. 预检不再定时轮询，改为基于缓存即时计算；用户点「重新检查」时才强制刷新。

### L4 一次生成采集 3 遍，进度是假的

- 预检是一次完整采集（`subscriptionJobs.ts:88`），`updateSubscription` 又完整采集一次，前端预检轮询再算一次。
- `run()` 在真正工作之前就连续写入 collect/parse/deduplicate/encode/convert 五个进度事件
  （`subscriptionJobs.ts:193` 起），实际工作全部在一次 `updateSubscription()` 里完成。

**方案**：`ArtifactService` 拆成 `collect() → build() → validate() → publish()`，任务服务逐步调用并写入真实进度；
预检结果（含来源快照）直接交给本次生成复用；同一时刻只允许一个生成任务运行，其余排队（即 roadmap v1.7 的「update lock」）。

### L5 「部分成功」噪音，本机来源重复采集

- `artifactService.ts:172`：主控没有带 `url [name]` 的 233boy sing-box 时，每次都追加警告
  「本机: Sing-box不可用」。`subscriptionJobs.ts:206` 只要有任何警告就判为 `partial`，而且预检警告和生成警告会**重复出现两遍**。
  结果是很多部署每次任务都是「部分成功」，用户很快就会对黄色状态麻木。
- 默认安装会创建「本机节点」并通过本机 Agent 采集全部内核，旧的 `SingBoxAdapter` 本机采集器仍然同时运行。
  两者读到同一份 233boy 配置时 URL 相同，去重时保留先到的旧采集器条目，它的 `location` 固定为「本机」。所以**用户把本机节点的地域改成「🇯🇵 东京」之后，
  sing-box 节点名仍然是「本机 …」**。

**方案**：

1. 存在本机节点（`id=local`）时禁用旧本机采集器。旧采集器只为没有本机节点的历史部署保留，并在
   1.4 移除，同时移除 `protocols.sing_box_configs`。
2. 警告分级为 `info / warning / error`，只有影响输出的 warning/error 才判 `partial`。
3. 警告去重。

### L6 Cron 解析不完整

`cronField`（`subscriptionJobs.ts:392`）只认 `*`、`*/n` 和数字列表。`validatePolicy` 只检查字段数是 5，
所以 `0 9-18 * * *`、`0 4 * * 1-5` 能保存，却**永远不会触发**。另外星期 `7` 不被识别为周日；
时区跟随进程本地时间，systemd unit 没有设置 `TZ`，界面也没有说明。

**方案**：

- 换成成熟的零依赖 Cron 库（例如 `croner`），支持范围、步长和时区，保存时严格校验；
- 时区取 `app.timezone`，默认取系统时区；
- 界面显示「下次执行：11-09 04:00（Asia/Shanghai）」，并提供「每 6 小时 / 每天 04:00 / 每周一」等预设，
  高级模式下才显示原始 Cron 输入。

### L7 前端细节缺陷

| 问题 | 位置 | 修复 |
| --- | --- | --- |
| 「重试间隔」每次按键都 `split(',').map(Number).filter(isFinite)`，`Number('')` 为 0，导致输入逗号后立刻被改写成 `…, 0`，无法正常输入第三个值 | `subscription.tsx:277` | 编辑时保存原始字符串，失焦或保存时再解析校验；数值框同理（`Number(v) \|\| 0`） |
| 定时开关只改本地状态，不点「保存策略」离开就丢失，也没有未保存提示 | `subscription.tsx:266` | 开关即时保存；或在有未保存修改时高亮保存按钮，离开页面前提示 |
| 节点表「延迟」列和 Agent 卡片「心跳延迟」永远是 `—`：`NodeStatus.latency` 从未被赋值 | `nodes.tsx:398`、`nodeAggregationService.ts` | 心跳时记录 `/health` 往返耗时 |
| 预览弹窗写「只显示前 64 KiB」，后端实际截断 50 000 字符 | `Dashboard.tsx:291`、`subscriptionJobs.ts:180` | 统一常量并由接口返回 `limit` |
| 离线节点标「缓存」，但并没有缓存 | `subscription.tsx:247` | 随 D1 落地后如实显示「缓存（3 小时前）」，否则显示「不可读」 |
| 不开定时生成时，24 小时后产物显示「已过期」并长期告警。来源是静态的内核配置，「旧」不代表「错」 | `subscriptionJobs.ts:233` | 新鲜度改为相对「最近一次来源变化/采集」判断；未启用定时时不标过期 |
| 部署页预检阻断按节点记录，不区分组件和操作；从没预检也能直接部署 | `nodes.tsx` `blocked` | 「部署」按钮内置预检，按「节点 + 组件 + 操作」缓存结果 |
| 操作下拉对未安装组件也提供「卸载/修复」，对已安装组件也提供「安装」 | `nodes.tsx` `OPERATIONS` | 按安装状态过滤可用操作 |
| Agent 状态为 `error` 时没有「启动」按钮 | `nodes.tsx` Agent 标签 | 非 running 状态都提供启动 |
| 运行时标签对「已监控」内核固定写「运行中」，没有区分是否真的可读 | `nodes.tsx` runtime 标签 | 显示 `accessible`、`error` 和来源数量的真实状态 |
| 多处 `new Error(response.error \|\| …)`，`error` 是对象时界面会显示 `[object Object]` | `nodes.tsx` 编辑/启停等 | 统一使用 `errorMessage()` 工具函数 |

### L8 升级、卸载与 Agent 版本漂移

- `miobridge upgrade`（`self/service.ts`）只升级 CLI、Dashboard 和模板，**不升级本机 Agent**。
- `miobridge uninstall --purge`（`self/service.ts:166`）只删 CLI 和 `~/.config/miobridge`，安装脚本装的
  `~/.local/bin/miobridge-agent`、`~/.config/miobridge-agent/` 和 `miobridge-agent.service` 都会留下来，并继续监听 3001。
- `nodes configure --no-local-node`（`nodeRepository.ts:42`）只删档案，不停本机 Agent。
- 升级主控后，子节点 Agent 版本落后没有任何提示。

**方案**：

- `upgrade` 结束时同步升级本机 Agent（复用 release 中的 `install-agent.sh` 或部署通道），
  并列出版本落后的子节点；
- Dashboard 顶部提示「3 台服务器 Agent 版本落后 [一键升级]」，按节点串行执行；
- `uninstall` 停用并删除本机 Agent unit；`--purge` 同时删除 Agent 配置；
- 移除本机节点时询问是否同时卸载本机 Agent。

### L9 状态目录无限膨胀

- `metrics/<ts>.json` 由定时器每 5 分钟写一个，**每次 `GET /api/metrics` 还会再写一个**
  （`applicationRoutes.ts:235`、`nodeServer.ts:215`），没有任何清理。每次读取 30 天范围都要逐个打开近万个小文件，
  用得越久越慢。
- `SubscriptionJobService.list()` 每次调用都会遍历并解析全部任务文件，并执行一次过期清理；`get()` 也会调用 `list()`。

**方案**：

- 指标改为按天追加的 JSONL 文件（`metrics/2026-11-08.jsonl`），GET 不再写入；
- 超过 30 天的文件按天删除，7 天以前的数据降采样为每小时一条；
- 任务历史在启动时载入内存索引，之后增量维护；过期清理每小时执行一次即可。

### L10 Clash 重名时把完整 URL 拼进节点名

`sources.ts:40`：`baseName` 重复时，名称变成 `${baseName} [${完整 URL}]`。URL 里有 UUID、密码和
Reality 公钥，会直接显示在客户端节点列表中，名称也很长。

**方案**：重名时依次追加 ` 2`、` 3`，或追加 `· 协议/内核`，例如「东京 vless」「东京 hy2」；绝不使用 URL。

### L11 模板升级覆盖用户修改

`install.sh:152` 和 `self/service.ts:136` 无条件覆盖 `template.yaml`。目前想加自定义规则只能改这个文件，
下次升级就会被静默清掉。

**方案**（v1.4 输出定制之前的过渡）：

- 支持 `template.user.yaml`：存在时优先使用，并且不被升级触碰；
- 或者记录官方模板的 sha256，升级时如果发现本地已被修改，就写成 `template.yaml.new` 并提示用户合并；
- 配置页展示当前生效的是哪个模板。

### L12 状态写入不安全

- `FileStateStore.set`（`stateStore.ts:43`）直接 `writeFile`。写到一半时断电或进程被杀，`nodes.yaml` 就会损坏，
  之后 `NodeRepository.list()` 抛错，整个 Dashboard 不可用。
- `withLock` 只在进程内生效。Dashboard 运行时，同时执行 `miobridge nodes configure` 会产生跨进程竞争写。

**方案**：

- 统一改为「临时文件 + `fsync` + `rename`」，与产物发布保持一致；
- `nodes.yaml` 写入前保留一份 `.bak`，读取失败时自动回退并告警；
- 跨进程使用 `mkdir` 锁目录，或者在 Dashboard 运行时让 CLI 的写操作改走本机 API。

### L13 Webhook 只有测试事件

`/api/notifications/test`（`applicationRoutes.ts:264`）是唯一会发 Webhook 的地方，`webhook.events` 没人读取。

**方案**：实现事件：`subscription.failed`、`subscription.blocked`、`node.offline`、`node.recovered`、
`deployment.failed`、`agent.outdated`；失败重试 3 次并记录投递历史；提供 Telegram/Bark/企业微信等常见模板，
配置页可以一键测试。

### L14 死代码与无意义选项

- Agent `/api/update`（`agent/src/handlers/update.ts:27`）执行 `mihomo convert`，但 mihomo 没有这个子命令。
- 架构规定子节点只跑 Agent 和内核，但部署页仍提供「mihomo」组件，运行时标签对每台子节点都显示「mihomo 未安装」，
  容易让人以为子节点也需要装 mihomo。

**方案**：删除 Agent `/api/update` 和 Agent 配置中的 `mihomo` 段（兼容读取但忽略）；mihomo 只在本机节点和主控状态中出现。

### L15 API 一致性

- `GET /api/update`（`coreRoutes.ts:32`）会触发整次生成，链接预览或爬虫访问都可能触发。
- `/api/cluster/deploy*` 与 `/api/deployments*`、`/api/yaml/*`、`/api/configs` 与 `/api/config/*`
  这几组新旧接口并存。

**方案**：

- `/api/update` 改为 POST，GET 返回 405；
- 旧路由在 OpenAPI 中标注 `deprecated` 并在响应里加 `Deprecation` 头，1.4 删除；
- 前端只调用新接口。

---

## 4. P1：降低上手门槛

### U1 安装的「最后一公里」

**现状**：`install.sh` 结束时只打印「Future upgrades and removal…」（`install.sh:182`）：

- 不启动 Dashboard；
- 不显示访问地址；
- `~/.local/bin` 不在 PATH 时只给一句提示；
- linger 未启用时，`dashboard start` 在非 TTY 环境下会因为 linger 询问直接失败（`systemd.ts:253`）。

**方案**：

1. 安装默认执行：
   - `dashboard start`：非交互时直接尝试 `loginctl enable-linger $USER`，失败再给出 sudo 命令；
   - 本机已有内核时，执行一次 `update`。
   - 提供 `--no-start` 跳过。
2. PATH 处理：root 安装时链接到 `/usr/local/bin/miobridge`；普通用户询问后写入 `~/.profile`。
3. 结束时打印一张「下一步」卡片：

   ```text
   ✅ MioBridge 1.3.0 安装完成
   控制台    http://203.0.113.10:3000   （登录令牌：miobridge auth show）
   订阅地址  http://203.0.113.10:3000/clash.yaml?token=••••
   需要放行  3000/tcp（控制台），子节点需放行 3001/tcp（Agent）
   下一步    浏览器打开控制台 → 按引导添加服务器 → 扫码导入客户端
   ```

4. 新增 `miobridge doctor`，一次检查以下项目并给出修复命令：
   - PATH；
   - Dashboard 运行状态、linger；
   - mihomo、模板、本机 Agent；
   - 端口占用；
   - ufw/firewalld 是否放行；
   - 公网可达性（可选：通过 `public_base_url` 自检）。

### U2 首次使用引导

**现状**：首页首次打开只有 4 个数字和若干「尚未生成」；「就绪检查」只有文字，例如「服务器未安装；运行
`miobridge setup --yes`」，没有可点的操作。

**方案**：检测到「没有产物且服务器不超过 1 台」时进入向导：

1. **检查本机**：mihomo、本机 Agent、本机内核，每项都有「一键修复」按钮。
2. **准备协议内核**：本机没有内核时，解释「MioBridge 不生产代理，只汇总已有的 sing-box、Xray 或 V2Ray
   （233boy 脚本安装）」，并提供「在本机安装 sing-box」按钮，也可以跳过。
3. **添加子服务器**（可选）：直接打开 U3 的向导。
4. **生成订阅**：自动执行并展示结果。
5. **导入客户端**：显示二维码、复制链接和各客户端的一键导入（见 U4）。

完成后不再自动弹出，可以在「帮助」中重新打开。首页「就绪检查」中每个未就绪项都附一个直达操作按钮。

### U3 「添加服务器」一步到位

**现状**：添加节点要经过以下步骤，用户需要事先了解组件、操作和预检的概念：

1. 填表（地域必填，但没有说明用途）；
2. SSH 预检；
3. 保存；
4. 切换到「部署」标签，选择 Agent 和「安装」；
5. 再次预检；
6. 创建任务；
7. 去「运行时」检测并纳管；
8. 去「订阅」页生成订阅。

**方案**：改为一个分步向导，默认全自动，每一步都可以展开看细节：

1. **连接**：只需填写主机、用户名，以及密码或私钥。名称默认取主机名。「地域」改为可选，并说明它会作为节点名前缀出现在客户端里，
   可以选择国旗和城市。
2. **检查**：SSH、系统、架构、磁盘、systemd、下载工具（即现有预检），并新增「防火墙/安全组」提示：检测到
   ufw/firewalld 时，给出放行 3001 的具体命令。
3. **安装 Agent**：自动执行。验收超时（`HEALTH_TIMEOUT`）时直接显示放行命令，并提醒检查云厂商安全组。
4. **识别内核**：自动检测，已安装的直接纳管；一个都没有时提供「安装 sing-box/Xray/V2Ray」选项。
5. **更新订阅**：自动触发一次生成，结果显示「新增 6 个代理节点」。

节点档案、内核或启停发生变化时，默认在 30 秒防抖后自动重新生成订阅（可关闭），不再依赖用户记得去点。

### U4 订阅分发

**现状**：

- 「订阅」页只能生成订阅，复制地址在「总览」页；
- 复制使用 `window.location.origin`（`Dashboard.tsx:124`），通过 SSH 隧道访问时复制出来的是 `localhost`；
- 没有二维码和客户端导入；
- 客户端看到的配置名是 `clash.yaml`。

**方案**：

- 「订阅」页顶部放「我的订阅」卡片：Clash/mihomo、通用 Base64、原始链接三个地址，每个都有复制和二维码；
  并提供「导入 Clash Verge / FlClash / Stash / Shadowrocket / v2rayN」一键链接（如 `clash://install-config?url=`）。
- 链接基地址优先使用 `app.public_base_url`（D3 中实现）；未设置时检测访问来源，如果是 localhost 或内网地址，
  就提示「客户端可能无法访问，请设置公网地址」。
- 兼容路由增加 `Content-Disposition: inline; filename="MioBridge.yaml"` 和 `profile-update-interval`
  响应头，让客户端显示友好名称并按策略自动更新。
- CLI：`miobridge subscription url [--qr]`，在终端打印地址和二维码。

### U5 术语统一

「节点」目前同时表示服务器（节点页、节点在线）和代理条目（订阅节点、N 个节点）；另外还有来源、产物、内核、
Agent、控制面、本机节点等概念。建议统一为：

| 现用词 | 建议用词 | 含义 |
| --- | --- | --- |
| 节点（服务器） | **服务器** | 一台装了 Agent 的 VPS |
| 节点（订阅条目） | **代理节点** | 客户端里能选择的一条线路 |
| 本机节点 | **本机** | 运行控制台的这台服务器 |
| 内核 | **协议内核** | sing-box / Xray / V2Ray |
| 产物 | **订阅文件** | `clash.yaml` 等三个文件 |
| 来源 | **代理来源** | 从协议内核配置读出的链接 |

文案中统一使用新词，并为关键术语加悬浮说明。文档首页放一张「控制台 → 服务器（Agent + 协议内核）→ 订阅文件 → 客户端」
示意图。内部 API 字段名不改，只改界面文案。

### U6 CLI 体验

- **语言**：帮助是英文，输出是中英混杂（例如 `配置字段不存在`、`Local node enabled; …`）。建议默认按 `LANG` 选择，
  中文环境输出中文，并统一错误前缀和退出码说明。
- **新增命令**：
  - `nodes list [--json]`：显示 ID、名称、主机、在线状态和 Agent 版本。当前 `nodes diagnose <id>` 需要 UUID，
    但没有任何命令能列出 ID。
  - `dashboard restart`；
  - `dashboard url`；
  - `auth show/rotate`（S1）；
  - `subscription url`（U4）；
  - `doctor`（U1）。
- **参数**：`nodes diagnose/repair` 支持用名称或 ID 前缀匹配。
- **输出**：
  - `dashboard start/status` 输出访问地址（`commands.ts:6` 目前只有 State/Enabled/Lingering/Unit）；
  - `status` 增加 Dashboard 状态、服务器在线数、上次生成结果和订阅地址；
  - `update` 打印警告列表，不再只显示 `Nodes: N`。

### U7 文档重组

- `docs/DEPLOYMENT.md` 讲的是 Vercel 静态预览，但文件名让人以为是部署指南。改名为
  `docs/VERCEL-PREVIEW.md`，再把 `docs/DEPLOYMENT.md` 改写为自托管部署指南。
- 新增 `docs/QUICKSTART.zh-CN.md`：5 步上手（安装 → 打开控制台 → 添加服务器 → 生成 → 导入客户端），
  每步配截图。
- 新增 `docs/FAQ.zh-CN.md`，回答以下问题：
  - 端口和防火墙/安全组怎么设置；
  - 为什么要 root（或怎样使用普通用户）；
  - 233boy 是什么；
  - 为什么显示「部分成功」；
  - 怎样自定义规则；
  - 子节点离线后订阅会怎样；
  - 怎样迁移和备份。
- README 校正：
  - 「新增或编辑子节点时会先通过 SSH 检测内核」已不符合现状，当前 `AddNodeForm` 传入 `kernels: []`，
    不做检测；
  - 公共端点表中的 `/api/update` 随 L15 更新；
  - `config.yaml.example` 的 `app.version: 1.0.0` 已过时。
- `TROUBLESHOOTING.md` 增加中文版，并引用 `miobridge doctor`。

---

## 5. P2：工程质量

- **回归测试**：本文每一个缺陷都配一条单测或 E2E。重点：
  - 子节点失联时节点数不减（D1）；
  - 突降时拦截发布（D2）；
  - 每个配置字段都有消费者（D3）；
  - root 节点重试（L2）；
  - Agent 并发 `/health` 延迟上限（L3）；
  - Cron 语法（L6）；
  - 重试间隔输入（L7）；
  - 卸载后没有残留 unit（L8）。
- **前端组件化**：页面中大量内联 `style={{…}}` 重复实现状态胶囊、小按钮和单元格。抽成
  `StatusPill`、`PillButton`、`InfoCell` 组件，统一使用 Botanical Garden 变量，降低改样式时漏改的概率。
- **错误展示统一**：前端只保留一个 `errorMessage()`；后端统一 `{ code, message, retryable, hint }`，
  其中 `hint` 给出下一步操作（例如「放行 3001 端口」）。
- **清理遗留**：
  - 旧本机采集器（L5）；
  - `RedisStateStore`：使用 Upstash 环境变量，当前自托管形态用不到，确认无人使用后移除；
  - `docs/项目界面重设计方案-handoff.zip` 二进制文件移出仓库。

---

## 6. 实施路线

实施记录与回归证据见 [优化方案实施验收](OPTIMIZATION-IMPLEMENTATION.zh-CN.md)。勾选表示本次实现范围完成；跨真实 VPS 的耗时验收、未来版本删除旧 API 和有条件移除 Redis 的边界在验收记录中单列。

版本号仅供参考；roadmap 中 v1.3/v1.4 已有规划，本方案作为其前置的「体验与正确性」阶段。

### 阶段一：热修复（建议 1.2.24，约 1 周，低风险）

- [x] L7：重试间隔输入、延迟列、预览上限文案、「缓存」文案、操作下拉过滤、错误展示
- [x] L5：存在本机节点时禁用旧采集器；警告去重与分级
- [x] L10：重名后缀不再包含 URL
- [x] L6：保存 Cron 时拒绝不支持的语法（先止血，阶段二换库）
- [x] L9：metrics 清理；GET 不再写样本
- [x] L12：状态原子写，`nodes.yaml` 备份
- [x] L8：`uninstall` 清理本机 Agent unit
- [x] D4：移除 `subscription.clash_filename`
- [x] U6：`dashboard start/status` 输出访问地址；新增 `nodes list`

### 阶段二：安全与正确性（建议 1.3.0，约 2~3 周）

- [x] S1/S2：管理员令牌、订阅令牌、登录页、`auth` 命令、旧安装升级引导
- [x] D1/D2：来源快照缓存、突降拦截（`blocked` 状态）、发布 diff
- [x] D3：订阅策略单一数据源；字段实现或删除；字段消费者契约测试
- [x] L1：文件日志与日志页可用
- [x] L2：主控专用 SSH 密钥；凭据缺失时前端补录
- [x] L3：Agent 缓存与异步执行；主控心跳与采集解耦
- [x] L4：生成管线拆分与真实进度；生成锁
- [x] L6：Cron 库、时区、下次执行时间

### 阶段三：上手体验（建议 1.3.1，约 2~3 周）

- [x] U1：安装后自动启动、PATH 处理、「下一步」卡片、`doctor`
- [x] U2：首次使用向导；就绪检查可操作
- [x] U3：添加服务器向导；变更后自动重新生成
- [x] U4：订阅分发卡片、二维码、客户端一键导入、`public_base_url`
- [x] U5：术语替换
- [x] U6：CLI 本地化与其余新命令
- [x] U7：文档重组（QUICKSTART、FAQ、DEPLOYMENT 改写）

### 阶段四：持续完善（并入 roadmap v1.4/v1.5）

- [x] L8：主控升级联动本机 Agent；版本落后提示与一键升级
- [x] L11：用户模板覆盖层（衔接 v1.4 输出定制）
- [x] L13：Webhook 真实事件与常用模板（衔接 v1.5 告警规则）
- [x] L14/L15：删除死代码；旧 API 标记 deprecated（按原方案保留兼容窗口，1.4 再移除）
- [x] P2 工程项

---

## 7. 整体验收标准

1. **新用户**：一台全新 VPS，从执行 `curl … | bash` 到手机客户端扫码导入订阅，≤ 10 分钟；全程不需要看源码，
   不需要额外执行 SSH 命令（放行云安全组除外）。
2. **抖动容忍**：任意一台子节点 Agent 停机 1 小时，客户端拉取到的代理节点数不变，界面明确标注缓存来源。
3. **配置可信**：配置页、订阅页中任何「已保存」的修改都能观察到效果，或者该字段已被移除。
4. **可诊断**：Web 端日志页能看到最近一次生成的 info/warn/error，以及每台服务器的采集耗时。
5. **免重复输入**：root 服务器添加后，后续升级、修复和重试都不再要求输入密码。
6. **负载**：仪表盘保持打开 1 小时，每台子节点收到的 `/api/urls` 请求 ≤ 15 次（当前约每 4 秒一次）。
7. **安全**：未登录无法调用任何写接口；开启后，未带令牌无法下载订阅。

---

## 附录：问题定位索引

| ID | 主要位置 |
| --- | --- |
| S1 | `packages/cli/src/dashboard/foreground.ts:38`、`packages/cli/src/dashboard/systemd.ts:88`、`packages/cli/src/dashboard/server/nodeServer.ts`、`applicationRoutes.ts:41` |
| S2 | `packages/cli/src/dashboard/server/compatRoutes.ts` |
| D1 | `packages/core/src/nodes/nodeAggregationService.ts:148`、`packages/core/src/artifacts/artifactService.ts:92` |
| D2 | `packages/cli/src/operations/subscriptionJobs.ts:93`、`packages/frontend/src/pages/subscription.tsx:247` |
| D3 | `packages/core/src/config/configValidation.ts`（`CONFIG_FIELDS`）、`subscriptionJobs.ts`（`policy()`） |
| D4 | `packages/core/src/config/configService.ts:86`、`compatRoutes.ts:15` |
| L1 | `packages/cli/src/composition.ts:44,102`、`packages/cli/src/main.ts:19`、`packages/core/src/logs/localLogService.ts` |
| L2 | `packages/cli/src/dashboard/server/nodeDependencies.ts:81`、`sshDeployment.ts:264,523,713`、`ssh/maintenance.ts` |
| L3 | `agent/src/handlers/urls.ts:73,280`、`nodeAggregationService.ts:103`、`pages/nodes.tsx`、`pages/subscription.tsx:46` |
| L4 | `subscriptionJobs.ts:88,193` |
| L5 | `artifactService.ts:172`、`subscriptionJobs.ts:206`、`packages/core/src/nodes/nodeRepository.ts:61` |
| L6 | `subscriptionJobs.ts:353,392` |
| L7 | `pages/subscription.tsx:266,277`、`pages/nodes.tsx:398`、`components/Dashboard.tsx:291` |
| L8 | `packages/cli/src/self/service.ts:166`、`nodeRepository.ts:42` |
| L9 | `applicationRoutes.ts:235`、`nodeServer.ts:215`、`subscriptionJobs.ts`（`list()`） |
| L10 | `packages/core/src/artifacts/sources.ts:40` |
| L11 | `scripts/install.sh:152`、`self/service.ts:136` |
| L12 | `packages/core/src/state/stateStore.ts:43` |
| L13 | `applicationRoutes.ts:264` |
| L14 | `agent/src/handlers/update.ts:27`、`pages/nodes.tsx`（`DEPLOY_COMPONENTS`） |
| L15 | `packages/cli/src/dashboard/server/coreRoutes.ts:32` |
| U1 | `scripts/install.sh:182`、`systemd.ts:253` |
| U3 | `components/cluster/AddNodeForm.tsx`、`pages/nodes.tsx` |
| U4 | `components/Dashboard.tsx:124`、`pages/subscription.tsx` |
| U6 | `packages/cli/src/command.ts`、`packages/cli/src/dashboard/commands.ts:6` |
| U7 | `docs/DEPLOYMENT.md`、`README.zh-CN.md`、`config.yaml.example` |
