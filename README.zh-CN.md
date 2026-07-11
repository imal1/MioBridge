# MioBridge

[English](./README.md)

> 基于 mihomo 的分布式订阅转换与控制面板。MioBridge 将 sing-box、Xray、
> V2Ray 节点源聚合为 Clash 兼容输出，并提供 SSR 仪表盘、远程 Agent
> 支持和 Vercel 生产部署流程。

MioBridge 是一个单体 Next.js 全栈服务。仪表盘、API 路由、定时任务和后端
转换服务都位于 `frontend/`。生产环境直接运行 Next standalone 输出，不需要
单独的 Express 服务。

## 功能亮点

- **多协议聚合**：支持 vless、vmess、trojan、hysteria2、tuic、shadowsocks
- **Clash 兼容输出**：生成 `raw.txt`、`subscription.txt` 和 `clash.yaml`
- **分布式节点**：远程节点通过轻量 Agent 暴露节点源 URL
- **多内核 Agent**：一个子节点可同时监听 sing-box、Xray 和 V2Ray
- **HMAC 控制面**：主节点通过签名 HTTP 请求访问远程 Agent
- **SSR 仪表盘**：Next.js Pages Router 页面，使用 Botanical Garden 主题
- **定时刷新**：支持自动更新，也可通过 API 或页面手动触发
- **Vercel 部署**：Vercel Git Integration 将推送部署到生产环境

## 技术栈

| 层 | 技术 |
| --- | --- |
| 运行时 | 生产环境 Node.js 18+，开发和构建使用 Bun |
| 应用 | Next.js Pages Router、Node runtime、standalone 输出 |
| UI | React、Tailwind CSS、Botanical Garden 设计变量 |
| 转换 | mihomo |
| 配置 | `~/.config/miobridge` 下的 YAML 文件 |
| Agent | Bun 编译的远程节点服务 |
| 部署 | Vercel、GitHub Actions |

## 快速开始

```bash
git clone https://github.com/imal1/MioBridge.git
cd MioBridge
bun install
bun run dev
```

打开 `http://localhost:3001`。

生产构建和 standalone 启动：

```bash
bun run build
bun run start
```

运行时配置和生成文件位于仓库外：

```text
~/.config/miobridge/
  config.yaml
  nodes.yaml
  raw.txt
  subscription.txt
  clash.yaml
  log/
  bin/
```

## 常用命令

```bash
bun run lint
bun run typecheck
bun run build
cd frontend && bun run test
cd agent && bun test
```

构建远程 Agent 二进制：

```bash
cd agent
bun build src/server.ts --compile --target=bun-linux-x64 --outfile miobridge-agent
```

## 多内核 Agent

新增或编辑子节点时，MioBridge 会先通过 SSH 检测 sing-box、Xray 和 V2Ray。
选择对话框会分别显示各内核的已安装版本与默认配置路径。至少选择一个内核；
已选择但缺失的内核会在部署阶段安装，已安装但未选择的内核仍会显示为“未监听”。

Agent 配置使用有序的 `kernels` 列表，因此同一个子节点可以发布多个运行时的
结构化来源：

```yaml
kernels:
  - type: xray
    configPath: /usr/local/etc/xray/config.json
  - type: v2ray
    configPath: /etc/v2ray/config.json
```

“检测到”“监听中”和“健康”是相互独立的状态：检测到表示找到了可执行文件；
监听中表示该内核已写入 Agent 配置；健康表示配置文件可读取且能提取节点源。
仪表盘会按内核分别展示这些状态、配置路径、错误和代理数量。

聚合时，原始 URL 保留原名称；用于 Clash 订阅的名称会加上子节点 `location`
地区前缀。如果多个来源加前缀后仍然重名，MioBridge 会在方括号中追加来源
URL，保证生成的代理名称唯一。

## 公共端点

| 端点 | 用途 |
| --- | --- |
| `/` | SSR 仪表盘 |
| `/api/health` | 健康检查 |
| `/api/status` | 服务状态 |
| `/api/update` | 触发订阅刷新 |
| `/api/convert` | 转换传入的订阅内容 |
| `/subscription.txt` | base64 订阅输出 |
| `/clash.yaml` | Clash YAML 输出 |
| `/raw.txt` | 原始节点列表输出 |

兼容路径由 Next rewrites 提供，因此公开 URL 保持稳定，具体实现仍在 API
routes 内部。

## 项目结构

```text
frontend/
  src/pages/                 Next 页面和 API routes
  src/server/                与框架无关的后端服务
  src/components/            仪表盘 UI
  next.config.js             standalone 输出和 rewrites
agent/                       远程节点 Agent
scripts/                     安装、管理和部署脚本
docs/                        部署和运维文档
.github/workflows/           CI/CD 工作流
```

## 部署

生产部署通常由推送 `main` 触发。Vercel Git Integration 会构建已连接项目，
并发布生产部署。

完整部署说明见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)，CI/CD 说明见
[docs/CI-CD.md](./docs/CI-CD.md)。

## 运维

常用生产检查：

```bash
curl -fsS https://miobridge.vercel.app/api/health
```

故障排查见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

## 许可证

MIT
