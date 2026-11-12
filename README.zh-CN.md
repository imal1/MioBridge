# MioBridge

## 开始使用

[五步上手（含截图）](docs/QUICKSTART.zh-CN.md) · [自托管部署](docs/DEPLOYMENT.md) · [FAQ](docs/FAQ.zh-CN.md) · [故障排查](TROUBLESHOOTING.zh-CN.md)

```mermaid
flowchart LR
  A[控制台] --> B[服务器：Agent + 协议内核]
  B --> C[主控汇总代理来源]
  C --> D[订阅文件]
  D --> E[客户端代理节点]
```

控制台 API 需要管理员会话或 Bearer 令牌（`miobridge auth show`）。新安装的订阅地址需要独立令牌（`miobridge subscription url --qr`），`/health` 保持公开。旧安装在控制台提示启用订阅保护。服务器离线时默认复用最多 72 小时的成功来源；数量突降超过阈值时保留旧订阅，需人工检查差异。


[English](./README.md)

> 基于 mihomo 的分布式订阅转换与控制面板。MioBridge 将 sing-box、Xray、
> V2Ray 节点源聚合为 Clash 兼容输出，并提供 SPA 仪表盘、远程 Agent
> 支持和单二进制 Linux CLI。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/imal1/MioBridge/main/scripts/install.sh | bash
```

引导脚本安装经过校验的 Linux CLI、静态仪表盘和固定版本运行依赖；默认把当前
服务器登记为本机节点，并安装同版本的用户态 Agent。Agent 只监听已经安装且
配置可读的协议内核；部署 Agent 不会安装 sing-box、Xray 或 V2Ray。使用
`--no-local-node` 可跳过本机节点和 Agent。安装过程不会克隆或构建源码仓库，
运行数据位于 `~/.config/miobridge/`。

## CLI

```bash
miobridge update              # 刷新订阅
miobridge status --json       # 查看服务状态
miobridge dashboard start     # 启动仪表盘 + API（端口 3000）
miobridge dashboard stop      # 停止仪表盘
miobridge dashboard status    # 查看仪表盘状态
miobridge upgrade             # 升级到最新的已校验 CLI release
miobridge --help              # 列出所有命令
```

`dashboard` 命令以单进程托管静态 Vite SPA 和 API 路由，无需 Node.js 运行时
或独立 web 服务器。

## 卸载

```bash
miobridge dashboard stop
miobridge uninstall           # 保留配置、数据、日志和备份
miobridge uninstall --purge   # 同时删除配置、数据及托管依赖
```

## 开发

```bash
git clone https://github.com/imal1/MioBridge.git
cd MioBridge
bun install

# 终端 1：仪表盘（Vite 开发服务器，端口 5173）
bun run dev

# 终端 2（仓库根目录）：CLI 服务端（端口 3000）
bun run core:build
bun packages/cli/src/main.ts dashboard foreground

# 测试
bun run core:test
bun run cli:test
bun run --cwd packages/frontend test
bun run --cwd agent test
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| CLI | Bun 编译的单二进制文件 |
| 核心 | `@miobridge/core`（无头配置、状态、转换、产物） |
| 仪表盘 | Vite React SPA、React Router、Botanical Garden 设计变量 |
| 转换 | mihomo |
| Agent | Bun 编译的远程节点服务 |
| 配置 | `~/.config/miobridge/` 下的 YAML 文件 |

## 公共端点

| 端点 | 用途 |
| --- | --- |
| `/` | SPA 仪表盘 |
| `/health` | 健康检查 |
| `/api/status` | 服务状态 |
| `POST /api/update` | 管理员认证后触发订阅刷新；GET 返回 405 |
| `/api/convert` | 转换传入的订阅内容 |
| `/subscription.txt` | base64 订阅输出 |
| `/clash.yaml` | Clash YAML 输出 |
| `/raw.txt` | 原始节点列表输出 |

## 项目结构

```text
packages/cli/                CLI 二进制、仪表盘服务端、HTTP 与 SSH 适配器
packages/core/               无头配置、状态、转换、产物
packages/frontend/            Vite React SPA（CLI 消费的静态产物）
agent/                       远程节点 Agent
scripts/                     安装器、release 打包与 E2E 辅助脚本
docs/                        部署和运维文档
```

`MioBridgeCore` 是无头组合 facade。CLI 服务端对其做薄 HTTP 封装，并托管
`packages/frontend/dist/` 中的静态 Vite 包。仪表盘 SPA 仅通过类型化 HTTP 客户端与
CLI 通信。CLI 二进制统一负责 API 与静态文件服务。

## 多内核 Agent

节点详情的 **Agent** 标签页可运行体检，逐项查看 Linger、开机启动、运行状态、
重启次数、版本和公开健康接口。修复需要显式点击，完成后会断开 SSH 并独立验收。
也可以通过 CLI 操作：

```bash
miobridge nodes diagnose <node-id> --json
miobridge nodes repair <node-id>
miobridge nodes migrate-service <node-id> --user <existing-non-root-user>
```

系统级服务迁移是可选操作，需要 root 或 sudo 权限。先在临时回环端口验证新服务，
再切换；任何验收失败均回滚。运行文件保存在指定用户的 `~/.config/miobridge/`，
后续升级、修复与卸载会识别其服务模式。支持回环候选服务的 Agent 版本是迁移前提，
旧 Agent 会提示先升级。现有节点不会自动迁移。

心跳首次失败显示“波动”，连续 3 次失败显示“异常”，5 次失败显示“离线”；
连续 2 次成功后恢复在线，最近异常原因与时间仍可查看。

添加服务器时先完成 SSH 预检并确认指纹，默认自动安装 Agent、检测已安装的协议内核、
纳管并生成订阅。未检测到协议内核时可选择安装或稍后配置；取消自动流程则只保存档案。
编辑服务器不会自动重装组件，监控范围在服务器详情中调整。

协议内核的安装、升级、修复、重装和卸载统一委托给上游 233boy 管理脚本
（`233boy/sing-box`、`233boy/Xray`、`233boy/v2ray`）。MioBridge 检测
`/usr/local/bin/<内核>` 管理入口并读取 `/etc/<内核>` 下的配置；只有官方裸内核、
但没有 `url [name]` 命令时，不会被误判为可用的节点来源。
首次安装始终直接执行对应上游 `install.sh`，维护操作始终直接调用这个全局
wrapper。上游安装器或 wrapper 明确报告需要 root 权限时，MioBridge 会对同一命令
自动提权重试；协议内核不提供另一套 rootless 安装布局。

CLI 会为子节点选择同版本的 x64/arm64 Agent Release 制品，使用
`SHA256SUMS` 校验后安装到 SSH 用户目录，并通过 `systemctl --user` 管理；该流程
不需要 sudo、Git、Bun 或源码构建。

Agent 配置使用有序的 `kernels` 列表，因此同一个子节点可以发布多个运行时的
结构化来源：

```yaml
kernels:
  - type: xray
    configPath: /etc/xray/config.json
  - type: v2ray
    configPath: /etc/v2ray/config.json
```

"检测到""监听中"和"健康"是相互独立的状态：检测到表示找到了可执行文件；
监听中表示该内核已写入 Agent 配置；健康表示配置文件可读取且能提取节点源。
仪表盘会按内核分别展示这些状态、配置路径、错误和代理数量。

聚合时，原始 URL 保留原名称；用于 Clash 订阅的名称会加上子节点 `location`
地区前缀。如果多个来源加前缀后仍然重名，MioBridge 会在方括号中追加来源
URL，保证生成的代理名称唯一。

### 订阅出口：域名、SNI 与证书校验

233boy 管理脚本按公网 IP 导出分享链接，并固定带上跳过证书校验的参数。给内核
配置了正式域名证书后，在节点详情 **概览 → 订阅出口** 中为该节点设置连接域名、
TLS SNI、证书校验策略和订阅显示名称。设置保存在主节点的
`~/.config/miobridge/nodes.yaml`，在每次订阅更新时统一应用到 `raw.txt`、
`subscription.txt` 和 `clash.yaml`，订阅更新和 Dashboard 重启都不会恢复旧值；
无需修改子节点、233boy 脚本或生成产物。

```yaml
nodes:
  - id: ht
    host: 203.0.113.7            # Agent 管理地址，不受出口设置影响
    proxy:
      server: ht.example.com     # 客户端连接域名
      sni: ht.example.com        # TLS server name
      certVerify: strict         # strict → skip-cert-verify: false；insecure → 自签证书
      protocols: [trojan, hysteria2]   # 可选；缺省对该节点全部协议生效
      displayName: HT            # 导出为「HT Trojan」「HT Hysteria2」
```

每个字段都是显式选择，留空即沿用内核上报值：MioBridge 不会因为内核配置了
`server_name` 就认定证书可信。`sni` 与 `certVerify` 只作用于使用证书的 TLS
协议（Trojan、Hysteria2、TUIC、VLESS/VMess over TLS），Reality 与明文协议不受
影响；端口、密码和其余协议参数保持原样。显示名称会同时写入 Clash 节点和模板
策略组引用。API 为 `PATCH /api/cluster/nodes/{id}` 的 `proxy` 字段，提交 `null`
即清除。

没有浏览器的服务器上用 CLI 完成同样的设置。它逐字段修改：只改动给出的选项，
空值（或 `--cert-verify inherit`、`--protocols all`）清除单个字段，`--clear`
清除全部；不带选项时显示当前设置和不受影响的 Agent 管理地址。

```bash
miobridge nodes proxy ht --server ht.example.com --sni ht.example.com \
  --cert-verify strict --protocols trojan,hysteria2 --name HT
miobridge nodes proxy ht --json     # 查看当前设置
miobridge update --json             # 重新生成订阅产物
```

## 运维

```bash
curl -fsS http://localhost:3000/health
miobridge status --json
```

故障排查见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

## 许可证

MIT
