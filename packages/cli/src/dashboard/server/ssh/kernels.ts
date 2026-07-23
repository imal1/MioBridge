/**
 * Stateless kernel probing/installation over an established connection.
 * Higher layers own target resolution and the connection lifecycle; these
 * helpers only run commands and interpret their output.
 */
import type { KernelType, NodeKernelConfig } from '@miobridge/core';
import { KERNEL_SCRIPTS, installCommand, wrapperCommand } from '../kernelScripts.js';
import { shellQuote } from './util.js';
import { DEFAULT_CONFIG_PATHS, type DeploymentConnection, type KernelDetection, type SshTarget } from './types.js';
import type { SshTransport } from './transport.js';

export async function detectKernel(transport: SshTransport, ssh: DeploymentConnection, type: KernelType): Promise<KernelDetection> {
  try {
    const definition = KERNEL_SCRIPTS[type];
    const probe = [
      `test -x ${shellQuote(definition.wrapperPath)}`,
      `${wrapperCommand(type, 'help')} 2>&1 | grep -F 'url [name]' >/dev/null`,
      `${wrapperCommand(type, 'version')} 2>&1`,
    ].join(' && ');
    const result = await transport.exec(ssh, probe);
    const output = (result.stdout || result.stderr).replace(/\[[0-9;]*m/g, '').trim();
    const version = output.split(/\r?\n/).find(line => line.trim())?.trim();
    // probe 的第一步就是 test -x wrapperPath，code === 0 意味着这个路径
    // 在目标主机上确实存在且可执行，可以如实上报，不需要前端再去猜。
    return result.code === 0
      ? { type, installed: true, ...(version ? { version } : {}), defaultConfigPath: DEFAULT_CONFIG_PATHS[type], binaryPath: definition.wrapperPath }
      : {
          type, installed: false, defaultConfigPath: DEFAULT_CONFIG_PATHS[type],
          error: output || `未找到兼容的 233boy ${type} 管理脚本: ${definition.wrapperPath}`,
        };
  } catch (error) {
    return { type, installed: false, defaultConfigPath: DEFAULT_CONFIG_PATHS[type], error: error instanceof Error ? error.message : '检测失败' };
  }
}

export async function ensureKernel(transport: SshTransport, ssh: DeploymentConnection, target: SshTarget, kernel: NodeKernelConfig): Promise<void> {
  if ((await detectKernel(transport, ssh, kernel.type)).installed) return;
  const installed = await transport.execWithPrivilegeFallback(ssh, target, installCommand(kernel.type));
  if (installed.code !== 0 && !/installed|success|生成配置文件|链接 \(URL\)|使用协议/.test(installed.stdout)) {
    throw new Error(`${kernel.type} 安装失败: ${(installed.stderr || installed.stdout).trim()}`);
  }
  if (!(await detectKernel(transport, ssh, kernel.type)).installed) throw new Error(`${kernel.type} 安装后检测失败`);
}
