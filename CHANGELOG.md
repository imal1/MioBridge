# Changelog

本文档记录 MioBridge 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循语义化版本规范。

## [1.0.0] — 2026-06-28

### Added
- **全栈控制面架构**：Web 仪表盘与订阅转换服务整合部署
- **Web 仪表盘**：Botanical Garden 主题、客户端状态轮询、暗色模式自适应
- **零接触多节点部署（Agent）**：Agent 子包（`agent/`），含 HTTP 服务器、配置解析、Linux amd64/arm64 构建脚本
- **DeployManager 服务**：SSH 远程部署管理，支持节点注册、代理生命周期、内核管理
- **UpdateChecker 服务**：版本检查与自动更新管理
- **部署 UI 组件**：AddNodeForm、DeployProgressDialog、NodeDetail Agent 信息区域、BatchActions
- **部署 CLI**：`deploy`、`deploy:status`、`deploy:rollback` 等命令
- **部署 API**：`/api/deploy/*`、`/api/agent/*`、`/api/kernel/*`
- **HMAC 认证中间件**：节点间安全通信，带重放保护
- **NodeManager 服务**：多节点注册、状态轮询、HMAC 签名
- **KernelAdapter 体系**：SingBoxAdapter、XrayAdapter、V2rayAdapter 统一接口
- **协议全支持**：vless (含 reality)、vmess、trojan、hysteria2、tuic、shadowsocks
- **mihomo 转换内核**：本地命令行调用，替代 subconverter
- **定时订阅更新**：node-cron，Asia/Shanghai 时区
- **Winston 结构化日志**
- **`config.yaml` 配置管理**：YAML 解析与缺失默认值
- **API 端点**：`/api/health`、`/api/status`、`/api/update`、`/api/convert`、`/api/configs`
- **文件端点**：`/subscription.txt`、`/clash.yaml`、`/raw.txt`
- **原子部署**：GitHub Actions → SSH → 软链接切换 → 健康检查 → 失败自动回滚
- **CI/CD**：PR 门禁（lint/typecheck/build）、自动部署、5 分钟健康监控
- **部署版本可见性**：仪表盘页脚显示 git commit hash 和构建时间
- **CLAUDE.md**：完整架构说明、设计系统、决策记录、排查指南

### Fixed
- **Vitest JSX 解析失败**：添加 `@vitejs/plugin-react` 统一处理 JSX，并排除 Agent 下的 Bun 测试
- **仪表盘状态轮询丢失**：`api.ts` 未解包 API 响应 `data` 字段
- **clash.yaml 生成失败**：修正配置序列化输出格式
- **版本号一致性**：硬编码版本统一为 `package.json` → `version.ts` 单例
- **User-Agent 硬编码**：`mihomoService` 改用动态 `VERSION` 导入
