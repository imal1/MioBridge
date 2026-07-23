/**
 * Stateless helpers for the SSH deployment subsystem: shell quoting,
 * systemd command assembly, credential/input validation, release-artifact
 * naming, network preflight, and value coercion.
 */
import { Buffer } from 'node:buffer';
import { lookup } from 'node:dns/promises';
import { createConnection, isIP } from 'node:net';
import { KERNEL_TYPES, type KernelType } from '@miobridge/core';
import type { ComponentDeployStatus, DeployComponent, DeployOperation } from './types.js';

export function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function userSystemctl(...args: readonly string[]): string {
  const command = ['systemctl', '--user', ...args].map(shellQuote).join(' ');
  return `XDG_RUNTIME_DIR=\"\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\" ${command}`;
}

export function validatePrivateKey(value: string): void {
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new Error('SSH 私钥不能超过 64 KiB');
  const trimmed = value.trim();
  if (!trimmed.includes('PRIVATE KEY-----')) throw new Error('无效的 SSH 私钥');
  if (trimmed.includes('ENCRYPTED PRIVATE KEY') || /Proc-Type:\s*4,ENCRYPTED|DEK-Info:/i.test(trimmed)) {
    throw new Error('暂不支持带口令的 SSH 私钥');
  }
}

export function agentRelease(
  version: string,
  architecture: 'x64' | 'arm64',
  env: NodeJS.ProcessEnv = process.env,
): { artifact: string; baseUrl: string } {
  const repository = env.MIOBRIDGE_REPOSITORY ?? 'imal1/MioBridge';
  return {
    artifact: `miobridge-agent-${version}-linux-${architecture}.gz`,
    baseUrl: env.MIOBRIDGE_RELEASE_BASE_URL ?? `https://github.com/${repository}/releases/download/v${version}`,
  };
}

export function kernelType(value: string): KernelType {
  if (!KERNEL_TYPES.includes(value as KernelType)) throw new Error(`不支持的内核类型: ${value}`);
  return value as KernelType;
}

export function deployComponent(value: string): DeployComponent {
  if (value === 'agent' || value === 'mihomo' || KERNEL_TYPES.includes(value as KernelType)) return value as DeployComponent;
  throw new Error(`不支持的部署内容: ${value}`);
}

export function deployOperation(value: string): DeployOperation {
  if (['install', 'reinstall', 'upgrade', 'repair', 'uninstall'].includes(value)) return value as DeployOperation;
  throw new Error(`不支持的部署操作: ${value}`);
}

export function legacyStep(
  step: ComponentDeployStatus['step'] | 'preflight' | 'install' | 'configure' | 'verify',
): ComponentDeployStatus['step'] {
  if (step === 'preflight') return 'prechecking';
  if (step === 'install') return 'installing';
  if (step === 'configure') return 'configuring';
  if (step === 'verify') return 'postchecking';
  return step;
}

export async function networkPreflight(
  host: string,
  port: number,
): Promise<{ dns: { ok: boolean; detail: string }; tcp: { ok: boolean; detail: string } }> {
  let address = host;
  try {
    if (!isIP(host)) address = (await lookup(host)).address;
  } catch (error) {
    return { dns: { ok: false, detail: error instanceof Error ? error.message : '解析失败' }, tcp: { ok: false, detail: '未执行：DNS 失败' } };
  }
  const tcp = await new Promise<{ ok: boolean; detail: string }>(resolve => {
    const socket = createConnection({ host: address, port });
    const timer = setTimeout(() => finish(false, `连接 ${address}:${port} 超时`), 5_000);
    function finish(ok: boolean, detail: string) { clearTimeout(timer); socket.destroy(); resolve({ ok, detail }); }
    socket.once('connect', () => finish(true, `${address}:${port} 可达`));
    socket.once('error', error => finish(false, error.message));
  });
  return { dns: { ok: true, detail: isIP(host) ? `${host}（IP 地址）` : `${host} → ${address}` }, tcp };
}
