import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs-extra';
import { Client, type ClientChannel } from 'ssh2';
import { logger } from '../utils/logger';
import type { NodeAgentInfo } from '../types';

const KERNEL_INSTALL_SCRIPTS: Record<string, string> = {
  'sing-box': "bash <(wget -qO- -o- https://github.com/233boy/sing-box/raw/main/install.sh)",
  'xray': "bash <(wget -qO- -o- https://github.com/233boy/Xray/raw/main/install.sh)",
  'v2ray': "bash <(wget -qO- -o- https://github.com/233boy/v2ray/raw/master/install.sh)",
};

const AGENT_LOCAL_BINARY = path.resolve(process.cwd(), '..', 'agent', 'miobridge-agent');
const AGENT_REMOTE_PATH = '/usr/local/bin/miobridge-agent';
const AGENT_CONFIG_DIR = '/etc/miobridge-agent';
const AGENT_CONFIG_PATH = '/etc/miobridge-agent/agent.yaml';

export interface DeployStep {
  step: 'connect' | 'bun' | 'kernel' | 'agent' | 'start' | 'verify' | 'done';
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  progress: number;
}

export interface AgentStatus {
  deployed: boolean;
  version: string;
  status: NodeAgentInfo['status'];
  lastDeploy: string;
  bunVersion: string;
  kernelVersion: string;
}

export interface DeployTarget {
  nodeId: string;
  secret: string;
  agentPort?: number;
  ssh: {
    host: string;
    user: string;
    port?: number;
    keyPath: string;
    hostKey: string;
    password?: string;
  };
  /** 代理内核类型（从 nodes.yaml 传入，不再硬编码） */
  kernel: string;
}

export interface DeployResult {
  success: boolean;
  message: string;
}

export type DeployProgressCallback = (step: DeployStep) => void;

export class DeployManager {
  private static instance: DeployManager;

  public static getInstance(): DeployManager {
    if (!DeployManager.instance) {
      DeployManager.instance = new DeployManager();
    }
    return DeployManager.instance;
  }

  private constructor() {}

  /** 部署 Agent 到远程节点 */
  async deployToNode(
    target: DeployTarget,
    onProgress?: DeployProgressCallback,
  ): Promise<DeployResult> {
    const emit = (step: DeployStep) => {
      logger.info(`DeployManager [${target.nodeId}]: ${step.step} — ${step.message}`);
      onProgress?.(step);
    };

    try {
      // Step 1: connect
      emit({ step: 'connect', status: 'running', message: '正在建立 SSH 连接...', progress: 5 });

      const ssh = await this.connectSsh(target);

      emit({ step: 'connect', status: 'success', message: 'SSH 连接成功', progress: 15 });

      // Step 2: bun
      emit({ step: 'bun', status: 'running', message: '检查 Bun 运行时...', progress: 20 });

      const bunOk = await this.ensureBun(ssh, emit);
      if (!bunOk) {
        return { success: false, message: 'Bun 安装失败' };
      }

      emit({ step: 'bun', status: 'success', message: 'Bun 已就绪', progress: 35 });

      // Step 3: kernel
      emit({ step: 'kernel', status: 'running', message: '检查内核...', progress: 40 });

      const kernelType = target.kernel || 'sing-box';
      await this.ensureKernel(ssh, target, kernelType, emit);

      emit({ step: 'kernel', status: 'success', message: '内核已就绪', progress: 55 });

      // Step 4: agent
      emit({ step: 'agent', status: 'running', message: '上传 Agent 二进制...', progress: 60 });

      await this.uploadAgent(ssh, target, emit);

      emit({ step: 'agent', status: 'success', message: 'Agent 部署完成', progress: 80 });

      // Step 5: start
      emit({ step: 'start', status: 'running', message: '启动 Agent 服务...', progress: 85 });

      await this.startAgent(ssh, target, emit);

      emit({ step: 'start', status: 'success', message: 'Agent 已启动', progress: 92 });

      // Step 6: verify
      emit({ step: 'verify', status: 'running', message: '验证 Agent 健康状态...', progress: 95 });

      await this.verifyAgent(ssh, target, emit);

      emit({ step: 'verify', status: 'success', message: 'Agent 健康检查通过', progress: 98 });

      // Done
      emit({ step: 'done', status: 'success', message: '部署完成', progress: 100 });

      ssh.end();
      return { success: true, message: `Agent 部署到节点 ${target.nodeId} 成功` };
    } catch (error: any) {
      logger.error(`DeployManager: 部署到节点 ${target.nodeId} 失败: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  // ==================== SSH Helpers ====================

  private connectSsh(target: DeployTarget): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => resolve(conn));
      conn.on('error', (err: Error) => reject(new Error(`SSH 连接失败: ${err.message}`)));

      const connectOpts: any = {
        host: target.ssh.host,
        port: target.ssh.port || 22,
        username: target.ssh.user || 'root',
        readyTimeout: 15000,
        algorithms: {
          serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ssh-ed25519'],
        },
      };

      // Auth: prefer key, fallback to password
      if (target.ssh.keyPath) {
        connectOpts.privateKey = this.resolvePrivateKey(target.ssh.keyPath);
        if (target.ssh.password) {
          connectOpts.passphrase = target.ssh.password;
        }
      } else if (target.ssh.password) {
        connectOpts.password = target.ssh.password;
      } else {
        // Try agent-based auth
        connectOpts.agent = process.env.SSH_AUTH_SOCK || undefined;
      }

      // Add host key verification if provided
      if (target.ssh.hostKey) {
        connectOpts.hostHash = 'sha256';
        connectOpts.hostVerifier = (hashedKey: Buffer) => {
          return hashedKey.toString('base64') === target.ssh.hostKey;
        };
      } else {
        // First-time connection: accept key but DO NOT skip verification entirely.
        // The host key will be captured and persisted back to nodes.yaml for future verification.
        connectOpts.hostHash = 'sha256';
        connectOpts.hostVerifier = (hashedKey: Buffer) => {
          const hostKey = hashedKey.toString('base64');
          target.ssh.hostKey = hostKey;
          logger.info(`DeployManager: 首次连接 ${target.ssh.host}，已记录 host key`);
          return true;
        };
      }

      conn.connect(connectOpts);
    });
  }

  private resolvePrivateKey(keyOrPath: string): string {
    const trimmed = keyOrPath.trim();
    if (trimmed.includes('BEGIN ') || trimmed.includes('\n')) {
      return keyOrPath;
    }

    const expandedPath = trimmed.startsWith('~/')
      ? path.join(process.env.HOME || '', trimmed.slice(2))
      : trimmed;

    if (fs.existsSync(expandedPath)) {
      return fs.readFileSync(expandedPath, 'utf8');
    }

    return keyOrPath;
  }

  private execSsh(ssh: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      ssh.exec(command, (err: Error | undefined, channel: ClientChannel) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        channel.on('data', (data: Buffer) => { stdout += data.toString(); });
        channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        channel.on('close', (code: number) => {
          resolve({ stdout, stderr, code: code ?? -1 });
        });
      });
    });
  }

  private execRoot(
    ssh: Client,
    target: DeployTarget,
    command: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    if ((target.ssh.user || 'root') === 'root') {
      return this.execSsh(ssh, command);
    }

    const rootCommand = target.ssh.password
      ? `printf ${this.shellQuote(`${target.ssh.password}\n`)} | sudo -S -p '' bash -lc ${this.shellQuote(command)}`
      : `sudo -n bash -lc ${this.shellQuote(command)}`;

    return this.execSsh(ssh, rootCommand);
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  // ==================== Deploy Steps ====================

  private async ensureBun(ssh: Client, emit: (s: DeployStep) => void): Promise<boolean> {
    const check = await this.execSsh(ssh, 'which bun 2>/dev/null && bun --version 2>/dev/null || echo "NOT_FOUND"');

    if (check.stdout.includes('NOT_FOUND')) {
      logger.info('DeployManager: Bun 未安装，正在安装...');
      emit({ step: 'bun', status: 'running', message: '正在安装 Bun...', progress: 25 });

      const install = await this.execSsh(
        ssh,
        'curl -fsSL https://bun.sh/install | bash 2>&1',
      );

      if (install.code !== 0) {
        emit({ step: 'bun', status: 'error', message: `Bun 安装失败: ${install.stderr}`, progress: 30 });
        return false;
      }

      // Add bun to PATH via .bashrc
      await this.execSsh(ssh, 'export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && echo \'export BUN_INSTALL="$HOME/.bun"\' >> ~/.bashrc && echo \'export PATH="$BUN_INSTALL/bin:$PATH"\' >> ~/.bashrc');

      // Verify installation
      const verify = await this.execSsh(ssh, 'export PATH="$HOME/.bun/bin:$PATH" && bun --version 2>&1');
      if (verify.code !== 0) {
        emit({ step: 'bun', status: 'error', message: `Bun 安装验证失败: ${verify.stderr}`, progress: 30 });
        return false;
      }

      logger.info(`DeployManager: Bun ${verify.stdout.trim()} 安装成功`);
    } else {
      logger.info(`DeployManager: Bun 已安装: ${check.stdout.trim()}`);
    }

    return true;
  }

  private async ensureKernel(
    ssh: Client,
    target: DeployTarget,
    kernelType: string,
    emit: (s: DeployStep) => void,
  ): Promise<void> {
    // Check if kernel is already installed
    const kernelBin = kernelType === 'xray' ? 'xray' : (kernelType === 'v2ray' ? 'v2ray' : 'sing-box');
    const check = await this.execSsh(ssh, `which ${kernelBin} 2>/dev/null && echo "FOUND" || echo "NOT_FOUND"`);

    if (check.stdout.includes('NOT_FOUND')) {
      const installCmd = KERNEL_INSTALL_SCRIPTS[kernelType];
      if (!installCmd) {
        emit({ step: 'kernel', status: 'error', message: `不支持的内核: ${kernelType}`, progress: 50 });
        throw new Error(`不支持的内核类型: ${kernelType}`);
      }

      emit({ step: 'kernel', status: 'running', message: `正在安装 ${kernelType} 内核...`, progress: 45 });

      const install = await this.execRoot(ssh, target, installCmd + ' 2>&1');

      if (install.code !== 0 && !this.isKernelInstallSuccess(install.stdout)) {
        emit({ step: 'kernel', status: 'error', message: `内核安装失败: ${install.stderr || install.stdout}`, progress: 50 });
        throw new Error(`内核安装失败: ${install.stderr || install.stdout}`);
      }

      logger.info(`DeployManager: ${kernelType} 内核安装完成`);
    } else {
      logger.info(`DeployManager: ${kernelType} 内核已安装`);
    }
  }

  private isKernelInstallSuccess(stdout: string): boolean {
    return [
      'installed',
      'success',
      '生成配置文件',
      '链接 (URL)',
      '使用协议',
    ].some(marker => stdout.includes(marker));
  }

  private async uploadAgent(
    ssh: Client,
    target: DeployTarget,
    emit: (s: DeployStep) => void,
  ): Promise<void> {
    const tmpAgentPath = `/tmp/miobridge-agent-${target.nodeId}`;

    await this.execRoot(ssh, target, `mkdir -p ${AGENT_CONFIG_DIR} /usr/local/bin 2>&1`);

    if (fs.existsSync(AGENT_LOCAL_BINARY)) {
      // 控制面本地有编译好的二进制（自托管模式）：直接 SFTP 上传。
      await this.sftpUploadAgent(ssh, tmpAgentPath, emit);
    } else {
      // Serverless 控制面（如 Vercel）不打包 ~100MB 的 agent 二进制：
      // 目标机拉取与控制面同 commit 的源码，用部署流程已装好的 Bun 本地编译
      // （agent 只依赖内建模块，无需 bun install，且天然匹配目标机架构）。
      await this.buildAgentOnRemote(ssh, tmpAgentPath, emit);
    }

    const install = await this.execRoot(
      ssh,
      target,
      `install -m 755 ${tmpAgentPath} ${AGENT_REMOTE_PATH} && rm -f ${tmpAgentPath}`,
    );
    if (install.code !== 0) {
      const message = `Agent 安装失败: ${(install.stderr || install.stdout).trim()}`;
      emit({ step: 'agent', status: 'error', message, progress: 75 });
      throw new Error(message);
    }

    // Write agent.yaml
    const agentYaml = this.generateAgentYaml(
      target.nodeId,
      target.nodeId,
      target.secret,
      target.kernel || 'sing-box',
      target.agentPort || 3001,
    );
    await this.execRoot(ssh, target, `cat > ${AGENT_CONFIG_PATH} << 'YAML_EOF'\n${agentYaml}YAML_EOF\n`);

    // Write systemd unit
    const systemdUnit = this.generateSystemdUnit(target.secret);
    await this.execRoot(ssh, target, `cat > /etc/systemd/system/miobridge-agent.service << 'UNIT_EOF'\n${systemdUnit}UNIT_EOF\n`);

    logger.info('DeployManager: agent.yaml 和 systemd unit 已写入');
  }

  /** SFTP 上传本地二进制到 /tmp（非 root 用户无法直接写 /usr/local/bin） */
  private sftpUploadAgent(
    ssh: Client,
    remotePath: string,
    emit: (s: DeployStep) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ssh.sftp((err: Error | undefined, sftp: any) => {
        if (err) {
          emit({ step: 'agent', status: 'error', message: `SFTP 失败: ${err.message}`, progress: 70 });
          return reject(err);
        }

        sftp.fastPut(AGENT_LOCAL_BINARY, remotePath, { mode: 0o755 }, (putErr: Error | undefined) => {
          if (putErr) {
            emit({ step: 'agent', status: 'error', message: `上传失败: ${putErr.message}`, progress: 70 });
            return reject(putErr);
          }
          logger.info('DeployManager: Agent 二进制上传完成');
          resolve();
        });
      });
    });
  }

  /** 在目标机上拉取源码并用 Bun 编译 agent 二进制 */
  private async buildAgentOnRemote(
    ssh: Client,
    outputPath: string,
    emit: (s: DeployStep) => void,
  ): Promise<void> {
    const tarballUrl = this.agentSourceTarballUrl();
    emit({ step: 'agent', status: 'running', message: '目标机正在下载源码并编译 Agent...', progress: 65 });
    logger.info(`DeployManager: 控制面无本地 Agent 二进制，目标机从 ${tarballUrl} 构建`);

    const script = [
      'set -e',
      'export PATH="$HOME/.bun/bin:$PATH"',
      'command -v bun >/dev/null 2>&1 || { echo "bun 不在 PATH 中" >&2; exit 1; }',
      'workdir=$(mktemp -d /tmp/miobridge-agent-build.XXXXXX)',
      `trap 'rm -rf "$workdir"' EXIT`,
      `curl -fsSL ${this.shellQuote(tarballUrl)} -o "$workdir/src.tar.gz"`,
      'tar -xzf "$workdir/src.tar.gz" -C "$workdir" --strip-components=1',
      `cd "$workdir/agent" && bun build src/server.ts --compile --outfile ${this.shellQuote(outputPath)}`,
    ].join('\n');

    const result = await this.execSsh(ssh, `bash -c ${this.shellQuote(script)}`);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().slice(-500);
      const message = `Agent 远程构建失败: ${detail}`;
      emit({ step: 'agent', status: 'error', message, progress: 70 });
      throw new Error(message);
    }

    logger.info('DeployManager: Agent 已在目标机编译完成');
  }

  /** 与控制面同 commit 的源码 tarball 地址（可用 MIOBRIDGE_AGENT_SOURCE_TARBALL 覆盖） */
  private agentSourceTarballUrl(): string {
    if (process.env.MIOBRIDGE_AGENT_SOURCE_TARBALL) {
      return process.env.MIOBRIDGE_AGENT_SOURCE_TARBALL;
    }

    const owner = process.env.VERCEL_GIT_REPO_OWNER || 'imal1';
    const repo = process.env.VERCEL_GIT_REPO_SLUG || 'MioBridge';
    const buildCommit = process.env.NEXT_PUBLIC_GIT_COMMIT;
    const ref = process.env.VERCEL_GIT_COMMIT_SHA
      || (buildCommit && buildCommit !== 'unknown' ? buildCommit : '')
      || 'main';

    return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
  }

  private async startAgent(ssh: Client, target: DeployTarget, emit: (s: DeployStep) => void): Promise<void> {
    const result = await this.execRoot(
      ssh,
      target,
      'systemctl daemon-reload && systemctl enable miobridge-agent 2>&1 && systemctl restart miobridge-agent 2>&1',
    );

    if (result.code !== 0) {
      emit({ step: 'start', status: 'error', message: `启动失败: ${result.stderr || result.stdout}`, progress: 90 });
      throw new Error(`systemctl 启动失败: ${result.stderr || result.stdout}`);
    }

    // Wait a moment for the service to come up
    await new Promise(r => setTimeout(r, 2000));

    const status = await this.execRoot(ssh, target, 'systemctl is-active miobridge-agent 2>&1');
    if (!status.stdout.includes('active')) {
      emit({ step: 'start', status: 'error', message: `服务未运行: ${status.stdout.trim()}`, progress: 90 });
      throw new Error(`服务状态异常: ${status.stdout.trim()}`);
    }

    logger.info('DeployManager: Agent 服务已启动');
  }

  private async verifyAgent(
    ssh: Client,
    target: DeployTarget,
    emit: (s: DeployStep) => void,
  ): Promise<void> {
    const healthUrl = `http://localhost:${target.agentPort || 3001}/health`;

    // Try curl health check from remote host
    const result = await this.execSsh(
      ssh,
      `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}" ${healthUrl} 2>/dev/null && break; sleep 2; done`,
    );

    if (!result.stdout.includes('200')) {
      emit({ step: 'verify', status: 'error', message: `健康检查失败: HTTP ${result.stdout.trim() || 'timeout'}`, progress: 98 });
      throw new Error(`Agent 健康检查失败: ${result.stdout.trim() || 'timeout'}`);
    }

    logger.info('DeployManager: Agent 健康检查通过');
  }

  /** 获取内核安装命令 */
  getKernelInstallCmd(kernelType: string): string {
    const cmd = KERNEL_INSTALL_SCRIPTS[kernelType];
    if (!cmd) {
      throw new Error(`不支持的内核类型: ${kernelType}`);
    }
    return cmd;
  }

  /** 生成 agent.yaml 内容 */
  generateAgentYaml(
    nodeId: string,
    nodeName: string,
    secret: string,
    kernelType: string,
    port = 3001,
    kernelConfigPath?: string,
  ): string {
    const configPath = kernelConfigPath || this.getDefaultConfigPath(kernelType);
    return `# MioBridge Agent 配置 — 由控制面自动生成
node:
  id: "${nodeId}"
  name: "${nodeName}"
  secret: "${secret}"

kernel:
  type: "${kernelType}"
  configPath: "${configPath}"

mihomo:
  path: "/usr/local/bin/mihomo"

port: ${port}
`;
  }

  /** 生成 systemd unit 内容 */
  generateSystemdUnit(secret: string): string {
    return `[Unit]
Description=MioBridge Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/miobridge-agent
WorkingDirectory=/etc/miobridge-agent
Environment=MIOBRIDGE_NODE_SECRET=${secret}
Environment=MIOBRIDGE_AGENT_CONFIG=/etc/miobridge-agent/agent.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  }

  /** 生成 64 字符随机 HMAC secret */
  generateHmacSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private getDefaultConfigPath(kernelType: string): string {
    const paths: Record<string, string> = {
      'sing-box': '/etc/sing-box/config.json',
      'xray': '/usr/local/etc/xray/config.json',
      'v2ray': '/etc/v2ray/config.json',
    };
    return paths[kernelType] || '';
  }
}
