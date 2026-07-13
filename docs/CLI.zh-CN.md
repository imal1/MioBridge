# Linux CLI 与仪表盘运维

`miobridge` 是独立 Linux x64/arm64 命令。`update` 和 `status` 直接使用
`@miobridge/core`，不需要 Next.js 进程或仪表盘 provider。

它与 Vercel 托管的生产仪表盘分离；Vercel 部署见
[DEPLOYMENT.md](./DEPLOYMENT.md)。

## 安装与升级

选择明确的发布版本。下载安装脚本；如本地策略要求可先审查，然后执行：

```bash
curl -fLO https://raw.githubusercontent.com/imal1/miobridge/main/scripts/install-cli.sh
sh install-cli.sh --version 0.1.0
~/.local/bin/miobridge --version
```

安装器把 `x86_64`/`amd64` 映射到 `linux-x64`，把 `aarch64`/`arm64` 映射到
`linux-arm64`；从同一 GitHub Release 下载版本化压缩包和 `SHA256SUMS`，校验
SHA-256 后，原子替换 `~/.local/bin/miobridge`。需要 `curl` 或 `wget`、`tar`
以及 `sha256sum`（或 `shasum`）；不需要 Git、Node.js 或 Bun。

镜像、隔离网络或非默认安装目录：

```bash
sh install-cli.sh --version 0.1.0 \
  --base-url https://mirror.example/miobridge/v0.1.0 \
  --install-dir "$HOME/.local/bin"
```

下载、校验、解压或最终元数据替换失败时，旧 CLI 保持不变。用更高的明确版本
重复命令即可升级。

## 无头命令与保留数据

```bash
miobridge status --json
miobridge update
miobridge setup
```

运行时配置、生成产物、备份、日志和托管工具位于
`~/.config/miobridge`（或 `MIOBRIDGE_CONFIG_DIR`）。`status --json` 只输出一个
JSON 对象。即使 provider 目录不存在，`update` 和 `status` 仍可运行。

仅删除 CLI 二进制：

```bash
sh install-cli.sh --uninstall
```

此操作保留 `~/.config/miobridge`，包括 `config.yaml`、数据、订阅产物、日志与
备份。

## 托管依赖

`miobridge setup` 会将每个工具标记为 `configured`、`managed`、`PATH` 或
`missing`。每次托管下载前都会询问；拒绝不会写入文件。

| 工具 | 必需 | 用途 | 托管位置/来源 |
| --- | --- | --- | --- |
| mihomo | 是 | 生成 Clash 输出 | `~/.config/miobridge/bin`；固定 MetaCubeX GitHub Release |
| Bun | provider/本地构建需要 | 仪表盘 provider 运行时和本地构建 | `~/.config/miobridge/bin`；固定 Bun GitHub Release |
| yq v4 | 是 | YAML/配置操作 | `~/.config/miobridge/bin`；固定 mikefarah/yq GitHub Release |
| sing-box | 否 | 可选本地来源提取 | 已配置路径或 `PATH` |

准确版本、URL 与 SHA-256 在受审查源码
[`packages/cli/src/setup/catalog.ts`](../packages/cli/src/setup/catalog.ts) 中。
Setup 错误会隐藏凭据和查询参数中的密钥。

## Dashboard provider 与 systemd 用户服务

发布版 CLI 故意不包含仪表盘。自托管当前 Next standalone 输出时，可打包为
provider：

```bash
bun run build
bash scripts/package-dashboard-provider.sh "$HOME/.config/miobridge/dist/dashboard"
miobridge dashboard foreground
```

版本化 `provider.json` 声明可执行程序、入口、运行时环境、健康检查 URL 与四个
兼容 URL：`/health`、`/subscription.txt`、`/clash.yaml`、`/raw.txt`。未来 fn-4
可替换为 Vite 等 provider，不改变 CLI 命令或运行时数据归属。

持久 Linux 服务模式：

```bash
miobridge dashboard start
miobridge dashboard status --json
miobridge dashboard stop
```

`start` 会写入 `~/.config/systemd/user/miobridge-dashboard.service`，再通过
`systemctl --user` 启动。它会先询问是否启用 systemd linger；要在登出后继续运行
必须启用。非交互会话会提示手动执行：

```bash
sudo loginctl enable-linger "$USER"
```

没有 root system unit 或 PID 文件回退。已有 `miobridge.service` 时，先停止并
禁用它；CLI 也会拒绝被占用的仪表盘端口。排查日志：

```bash
journalctl --user -u miobridge-dashboard.service -f
```

删除可选仪表盘，同时保留 CLI/运行时数据：

```bash
miobridge dashboard stop
rm -rf "$HOME/.config/miobridge/dist/dashboard"
miobridge status --json
```

## 故障排查

- `checksum verification failed`：不要使用被修改的压缩包重试；从同一可信
  Release 或镜像取得匹配的压缩包与 `SHA256SUMS`。
- `Dashboard provider is not installed`：先安装/provider 打包；无头 `status` 和
  `update` 不受影响。
- `systemd user manager is unavailable`：改用 foreground，或使用带可用 user
  systemd manager 的 Linux。容器和非 systemd 系统不支持 daemon 模式。
- 登出后仪表盘退出：启用 linger，重新执行 `miobridge dashboard start`，再查看
  user journal。
- 端口占用或 provider 崩溃：先处理冲突，再使用 `dashboard status` 输出的 journal
  命令。
