# Changelog

本文档记录 MioBridge 的重要变更。版本号遵循语义化版本规范。

## [0.2.0] — 2026-07-15

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
