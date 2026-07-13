# MioBridge

[English](./README.md)

> 基于 mihomo 的分布式订阅转换与控制面板。MioBridge 将 sing-box、Xray、
> V2Ray 节点源聚合为 Clash 兼容输出，并提供 SPA 仪表盘、远程 Agent
> 支持和单二进制 Linux CLI。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/imal1/MioBridge/main/scripts/install.sh | bash
```

引导式安装：下载 Bun 和 mihomo，构建项目，可选配置 systemd。
所有文件位于 `~/.config/miobridge/`。

## CLI

```bash
miobridge update              # 刷新订阅
miobridge status --json       # 查看服务状态
miobridge dashboard start     # 启动仪表盘 + API（端口 3000）
miobridge dashboard stop      # 停止仪表盘
miobridge dashboard status    # 查看仪表盘状态
miobridge --help              # 列出所有命令
```

`dashboard` 命令以单进程托管静态 Vite SPA 和全部 API 路由。无 SSR、无
Node.js、无独立 web 服务器。

## 卸载

```bash
# 停止并移除 systemd 服务（Linux）
sudo systemctl disable --now miobridge
sudo rm /etc/systemd/system/miobridge.service
sudo systemctl daemon-reload

# 删除全部数据
rm -rf ~/.config/miobridge
```

## 开发

```bash
git clone https://github.com/imal1/MioBridge.git
cd MioBridge
bun install

# 仪表盘（Vite 开发服务器，端口 5173）
cd packages/frontend && bun run dev

# CLI 服务端（端口 3000，仪表盘将 /api 代理至此）
cd packages/cli && bun run dev -- dashboard start

# 测试
bun run core:test
bun run cli:test
cd packages/frontend && bun run test
cd agent && bun test
```

构建远程 Agent 二进制：

```bash
cd agent
bun build src/server.ts --compile --target=bun-linux-x64 --outfile miobridge-agent
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
| `/api/health` | 健康检查 |
| `/api/status` | 服务状态 |
| `/api/update` | 触发订阅刷新 |
| `/api/convert` | 转换传入的订阅内容 |
| `/subscription.txt` | base64 订阅输出 |
| `/clash.yaml` | Clash YAML 输出 |
| `/raw.txt` | 原始节点列表输出 |

## 项目结构

```text
packages/cli/                CLI 二进制、仪表盘服务端、HTTP 适配器、SSE
packages/core/               无头配置、状态、转换、产物
packages/frontend/            Vite React SPA（CLI 消费的静态产物）
agent/                       远程节点 Agent
scripts/                     安装、管理和部署脚本
docs/                        部署和运维文档
```

`MioBridgeCore` 是无头组合 facade。CLI 服务端对其做薄 HTTP 封装，并托管
`packages/frontend/dist/` 中的静态 Vite 包。仪表盘 SPA 仅通过类型化 HTTP 客户端与
CLI 通信——无 SSR、无 Next.js、无 Express。

## 多内核 Agent

新增或编辑子节点时，MioBridge 会先通过 SSH 检测 sing-box、Xray 和 V2Ray。
选择对话框会分别显示各内核的已安装版本与默认配置路径。至少选择一个内核；
已选择但缺失的内核会在部署阶段安装，已安装但未选择的内核仍会显示为"未监听"。

Agent 配置使用有序的 `kernels` 列表，因此同一个子节点可以发布多个运行时的
结构化来源：

```yaml
kernels:
  - type: xray
    configPath: /usr/local/etc/xray/config.json
  - type: v2ray
    configPath: /etc/v2ray/config.json
```

"检测到""监听中"和"健康"是相互独立的状态：检测到表示找到了可执行文件；
监听中表示该内核已写入 Agent 配置；健康表示配置文件可读取且能提取节点源。
仪表盘会按内核分别展示这些状态、配置路径、错误和代理数量。

聚合时，原始 URL 保留原名称；用于 Clash 订阅的名称会加上子节点 `location`
地区前缀。如果多个来源加前缀后仍然重名，MioBridge 会在方括号中追加来源
URL，保证生成的代理名称唯一。

## 运维

```bash
curl -fsS http://localhost:3000/api/health
miobridge status --json
```

故障排查见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

## 许可证

MIT
