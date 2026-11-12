# 故障排查

先运行 `miobridge doctor`，保存诊断输出；不要在公开 issue 中粘贴 `auth show`、订阅令牌或 SSH 密钥。

| 症状 | 排查与恢复 |
| --- | --- |
| 命令找不到 | 使用 `~/.local/bin/miobridge`；把 `~/.local/bin` 加入 PATH 后重新登录 shell |
| 控制台无法访问 | `miobridge dashboard status`、`miobridge dashboard start`；检查 3000/tcp、反向代理和安全组 |
| 退出 SSH 后服务停止 | `loginctl enable-linger <用户>`；再运行 `miobridge dashboard restart` |
| 控制台要求登录 | `miobridge auth show`；会话过期或管理员令牌轮换后需重新登录 |
| 订阅返回 401 | 使用 `miobridge subscription url` 获取独立订阅令牌地址；旧地址在轮换后失效 |
| Agent 离线 | `miobridge nodes list` 后 `miobridge nodes diagnose <名称或ID前缀>`；检查 3001/tcp、服务用户及 HMAC 配置 |
| SSH 凭据失效 | 在服务器详情编辑 SSH 凭据，重新预检并安装主控公钥；确认主机指纹 |
| 生成被阻止 | 查看订阅任务差异和缓存时间；排除采集故障后，手动确认强制发布 |
| 没有代理来源 | 检查协议内核配置和监控范围；Agent 安装成功不代表已安装协议内核 |
| 模板改动没生效 | 配置页查看生效模板；优先使用 `template.user.yaml` |
| 配置改了没生效 | 配置页查看“需重启”字段；订阅策略统一来自 config.yaml，可用 `miobridge config show` 验证 |
| nodes.yaml 损坏 | 日志确认已读取 .bak；停止服务，备份损坏文件并恢复 .bak，再启动 |

控制台日志位于 `~/.config/miobridge/logs/`；也可使用 `miobridge logs --lines 100`，或在日志页面按服务器、部署任务、订阅任务筛选。部署失败后先检查持久化任务错误，再重试，避免重复创建服务器档案。
