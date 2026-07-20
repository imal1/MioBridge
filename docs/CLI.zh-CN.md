# Linux CLI 与仪表盘运维

`miobridge` 是独立 Linux x64/arm64 命令。`update` 和 `status` 直接使用
`@miobridge/core`，不需要仪表盘 provider。

它与 Vercel 托管的生产仪表盘分离；Vercel 部署见
[DEPLOYMENT.md](./DEPLOYMENT.md)。

## 安装与升级

服务器端唯一的 shell 入口是首次引导安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/imal1/MioBridge/main/scripts/install.sh | bash
miobridge --version
```

安装器把 `x86_64`/`amd64` 映射到 `linux-x64`，把 `aarch64`/`arm64` 映射到
`linux-arm64`；从同一 GitHub Release 下载版本化压缩包和 `SHA256SUMS`，校验
SHA-256 后原子安装 `~/.local/bin/miobridge` 与
`~/.config/miobridge/dist/dashboard` 下的静态仪表盘，再执行
`miobridge setup --yes --local-node` 安装固定版本的运行依赖、保存本机节点档案，
并安装同版本的用户态 Agent。Agent 只监听已经安装且配置可读的协议内核，部署
Agent 不会顺带安装 sing-box、Xray 或 V2Ray。传入 `--no-local-node` 可跳过本机
节点与 Agent。需要 `curl` 或 `wget`、
`tar` 以及 `sha256sum`（或 `shasum`）；不需要 Git、Node.js、Bun 或源码仓库。

镜像、隔离网络或非默认安装目录：

```bash
sh install.sh --version 1.0.0 \
  --base-url https://mirror.example/miobridge/v1.0.0 \
  --install-dir "$HOME/.local/bin"
```

下载、校验、解压或最终替换失败时，会恢复上一版 CLI 与仪表盘。首次安装后
直接通过二进制同时升级两者：

```bash
miobridge upgrade
```

## 无头命令与保留数据

```bash
miobridge status --json
miobridge update
miobridge setup                              # 交互式选择本机节点
miobridge setup --yes --local-node           # 非交互式保存本机节点档案
miobridge nodes configure --no-local-node    # 移除本机节点档案
```

首次安装默认把当前服务器配置为本机节点。可以在安装时使用
`install.sh --no-local-node` 跳过，也可以随时重新配置：

```bash
miobridge nodes configure                 # 交互选择
miobridge nodes configure --local-node    # 启用本机节点
miobridge nodes configure --no-local-node # 仅保留子节点
```

启用后会在 `~/.config/miobridge/nodes.yaml` 写入一个名为「本机节点」的普通节点
档案（host 为 `127.0.0.1`）。它和手动添加的节点完全一样：出现在 Dashboard 节点
列表中，走相同的 Agent 部署与监控流程；唯一的区别是安装时默认创建。

运行时配置、生成产物、备份、日志和托管工具位于
`~/.config/miobridge`（或 `MIOBRIDGE_CONFIG_DIR`）。`status --json` 只输出一个
JSON 对象。即使 provider 目录不存在，`update` 和 `status` 仍可运行。

仅删除 CLI 二进制：

```bash
miobridge uninstall
```

此操作保留 `~/.config/miobridge`，包括 `config.yaml`、数据、订阅产物、日志与
备份。

如需同时删除 CLI 和整个 MioBridge 运行目录（配置、生成数据、仪表盘及托管依赖）：

```bash
miobridge uninstall --purge
```

## 托管依赖

`miobridge setup` 会将每个工具标记为 `configured`、`managed`、`PATH` 或
`missing`。每次托管下载前都会询问；拒绝不会写入文件。

| 工具 | 必需 | 用途 | 托管位置/来源 |
| --- | --- | --- | --- |
| mihomo | 是 | 生成 Clash 输出 | `~/.config/miobridge/bin`；固定 MetaCubeX GitHub Release |
| sing-box | 否 | 可选本地来源提取 | 已配置路径或 `PATH` |

准确版本、URL 与 SHA-256 在受审查源码
[`packages/cli/src/setup/catalog.ts`](../packages/cli/src/setup/catalog.ts) 中。
Setup 错误会隐藏凭据和查询参数中的密钥。

明确触发协议内核安装时，MioBridge 始终直接执行对应的 233boy 上游
`install.sh`；维护操作始终直接调用已经安装的 `/usr/local/bin/<内核>` wrapper。
MioBridge 不会添加 sudo 或提权重试；上游脚本自身的权限错误会原样返回。

远端 Agent 也遵循同一分层：CLI 选择同版本的 x64/arm64 压缩 Agent 制品，
校验 `SHA256SUMS` 后安装到 SSH 用户目录并由 `systemctl --user` 管理。该流程
不需要 sudo，不安装 Bun、不编译源码，也不安装任何协议内核。

子节点也可以从部署中心下载 `agent.yaml`，再使用同一个 Release 内的独立安装器：

```bash
scp agent.yaml child:/tmp/miobridge-agent.yaml
curl -fsSL https://github.com/imal1/miobridge/releases/latest/download/install-agent.sh \
  -o /tmp/install-agent.sh
sh /tmp/install-agent.sh --config /tmp/miobridge-agent.yaml
```

该脚本只管理 `~/.local/bin/miobridge-agent`、
`~/.config/miobridge-agent/agent.yaml` 和用户级 systemd unit。它会依次校验 checksum、
执行 `--version`、执行 `--check-config`、原子替换文件、重启服务并检查本机
`/health`；启动或健康检查失败会恢复原二进制、配置与 unit。它不安装主 CLI、
Dashboard、Bun、mihomo 或任何协议核心。镜像与独立参数模式见
[DEPLOYMENT.md](./DEPLOYMENT.md)。

## Dashboard provider 与 systemd 用户服务

Release 压缩包已包含仪表盘，由 `install.sh` 安装、`miobridge upgrade`
更新。

版本化 `provider.json` 声明静态产物目录与 SPA fallback，并保留
`/api`、`/health`、`/subscription.txt`、`/clash.yaml`、`/raw.txt`。替换静态
产物不会改变 CLI 命令或运行时数据归属。

持久 Linux 服务模式：

```bash
miobridge dashboard start
miobridge dashboard status --json
miobridge dashboard stop
```

`start` 会写入 `~/.config/systemd/user/miobridge-dashboard.service`，再通过
`systemctl --user` 启动，并等待 `/health` 可用后才报告成功；失败状态会先
`reset-failed` 再重试。它会先询问是否启用 systemd linger；要在登出后继续运行
必须启用。非交互会话会提示手动执行：

```bash
sudo loginctl enable-linger "$USER"
```

没有 root system unit 或 PID 文件回退。CLI 会拒绝被占用的仪表盘端口。
`miobridge uninstall` 会停用并删除该 user unit，再执行 `daemon-reload`，不会
遗留指向已删除 CLI 的服务。排查日志：

```bash
journalctl --user -u miobridge-dashboard.service -f
```

## 故障排查

- `checksum verification failed`：不要使用被修改的压缩包重试；从同一可信
  Release 或镜像取得匹配的压缩包与 `SHA256SUMS`。
- `Dashboard provider is not installed`：运行 `miobridge upgrade`、重新安装对应
  release；无头 `status` 和 `update` 不受影响。
- `systemd user manager is unavailable`：改用 foreground，或使用带可用 user
  systemd manager 的 Linux。容器和非 systemd 系统不支持 daemon 模式。
- 登出后仪表盘退出：启用 linger，重新执行 `miobridge dashboard start`，再查看
  user journal。
- 端口占用或 provider 崩溃：先处理冲突，再使用 `dashboard status` 输出的 journal
  命令。
