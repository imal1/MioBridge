# MioBridge 自托管部署

主控和 Agent 使用 Linux x64/arm64 的校验发布二进制。服务器不需要 Bun 或 Node.js。Vercel 只适合 [Dashboard 静态预览](VERCEL-PREVIEW.md)。

## 安装和首次登录

```sh
curl -fsSL https://github.com/imal1/MioBridge/releases/latest/download/install.sh -o install.sh
sh install.sh
miobridge dashboard url
miobridge auth show
```

安装器默认准备依赖、启动 Dashboard。`--no-start` 跳过启动；`--no-local-node` 只做主控；`--help` 列出安装选项。普通用户需要 systemd 用户服务及 Linger；非交互安装会尝试启用，失败时打印修复命令。root 默认安装到 `~/.local/bin` 并链接 `/usr/local/bin/miobridge`。普通用户可同意将 PATH 写入 `~/.profile`。

浏览器打开控制台，用 `auth show` 的管理员令牌登录。管理员令牌和订阅令牌相互独立，保存在权限为 0600 的 `~/.config/miobridge/auth.yaml`。登录会话有效期 24 小时，使用 HttpOnly、SameSite=Strict Cookie；HTTPS 下使用 Secure Cookie。轮换管理员令牌会使旧会话失效：

```sh
miobridge auth rotate
miobridge auth rotate --subscription
```

新安装默认保护订阅；旧安装保留已有客户端地址，控制台提示显式启用订阅保护。启用或轮换订阅令牌后，重新导入全部客户端。

## 网络与反向代理

- 控制台默认监听 3000/tcp。使用 HTTPS 反向代理时只向代理开放此端口。
- 子服务器 Agent 默认 3001/tcp，只需允许主控访问；请求使用 HMAC 验证。
- SSH 端口（默认 22）用于部署和诊断。协议内核端口按自身配置开放。
- 同时检查宿主机防火墙和云安全组，例如 `ufw allow 3000/tcp`，子服务器执行 `ufw allow from <主控IP> to any port 3001 proto tcp`。

为客户端配置实际可访问的公网地址：

```sh
miobridge config set app.public_base_url https://subscriptions.example.com
miobridge subscription url --qr
```

反向代理需保留 Host、转发 `/api/`、兼容订阅路径和 `/health`，关闭 SSE 缓冲并保留长连接。公网地址变化即时生效；端口及底层网络超时配置按配置页的「需重启」提示处理。不要把 `127.0.0.1` 或内网地址发给外网客户端。

## 添加服务器

填写主机、SSH 用户及凭据，执行预检并确认指纹。默认流程自动安装校验后的 Agent、检测协议内核、纳管并生成订阅。未发现内核时可选择安装 sing-box/Xray/V2Ray，也可稍后配置。服务器名称默认使用主机地址，地域标签可选，只影响客户端代理名称前缀。

root 凭据仅用于安装主控专用 SSH 公钥。主控验证密钥登录后保留 `ssh/id_ed25519`，不保存 root 密码；失败的临时凭据最多保留 30 分钟，后续可在服务器详情补充。普通用户需有相应服务和安装目录权限。

## 运维与恢复

```sh
miobridge doctor
miobridge status
miobridge nodes list
miobridge nodes diagnose <名称或ID前缀>
miobridge dashboard restart
miobridge logs --lines 100
miobridge upgrade
```

升级保留自定义模板，升级本机 Agent，并提示远端版本差异。Dashboard 可串行升级过期 Agent。`miobridge uninstall` 删除主控和本机 Agent 服务；`--purge` 同时删除配置和数据。移除本机档案时可选择卸载 Agent。

完整备份 `~/.config/miobridge`（包含 SSH 密钥、令牌、节点档案、最后成功来源及订阅）；不要公开这个备份。迁移时停止 Dashboard，复制目录并保持权限，再在新机启动。`nodes.yaml` 损坏时自动读取 `.bak` 并记录告警；应修复损坏主文件后再修改服务器档案。

更多见 [五步上手](QUICKSTART.zh-CN.md)、[FAQ](FAQ.zh-CN.md) 和 [故障排查](../TROUBLESHOOTING.zh-CN.md)。
