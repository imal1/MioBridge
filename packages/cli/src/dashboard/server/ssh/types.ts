/**
 * Shared types and constants for the SSH deployment subsystem.
 *
 * Split out of the former monolithic `sshDeployment.ts` so transport,
 * target resolution, installers, and the deployment orchestrator can share
 * a single vocabulary without importing each other.
 */
import type { KernelType, NodeKernelConfig } from '@miobridge/core';

// ── Remote paths ──────────────────────────────────────────────────────
export const AGENT_USER_BIN = '$HOME/.local/bin/miobridge-agent';
export const AGENT_USER_CONFIG = '$HOME/.config/miobridge-agent/agent.yaml';
export const AGENT_USER_UNIT = '$HOME/.config/systemd/user/miobridge-agent.service';
export const LEGACY_AGENT_PATH = '/usr/local/bin/miobridge-agent';
export const LEGACY_AGENT_CONFIG_PATH = '/etc/miobridge-agent/agent.yaml';
export const LEGACY_AGENT_SERVICE_PATH = '/etc/systemd/system/miobridge-agent.service';
export const MIHOMO_USER_PATH = '$HOME/.config/miobridge/bin/mihomo';

export const PROGRESS_TTL_MS = 10 * 60 * 1000;
export const TASK_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_CONFIG_PATHS: Record<KernelType, string> = {
  'sing-box': '/etc/sing-box/config.json',
  xray: '/etc/xray/config.json',
  v2ray: '/etc/v2ray/config.json',
};

// ── Detection results ─────────────────────────────────────────────────
export interface KernelDetection {
  readonly type: KernelType;
  readonly installed: boolean;
  readonly version?: string;
  readonly defaultConfigPath: string;
  /** 检测时以 test -x 实际验证过可执行的管理脚本路径；未安装时不返回。 */
  readonly binaryPath?: string;
  readonly error?: string;
}

export interface MihomoDetection {
  readonly installed: boolean;
  readonly version?: string;
  readonly path: string;
  readonly error?: string;
}

// ── Legacy (whole-node) deployment progress ───────────────────────────
export interface DeployStatus {
  readonly nodeId: string;
  readonly deploymentId: string;
  readonly step: 'connect' | 'kernel' | 'agent' | 'start' | 'verify' | 'done';
  readonly status: 'pending' | 'running' | 'success' | 'error';
  readonly message: string;
  readonly progress: number;
  readonly startedAt: number;
}

// ── Component deployment ──────────────────────────────────────────────
export type DeployComponent = 'agent' | 'mihomo' | KernelType;
export type DeployOperation = 'install' | 'reinstall' | 'upgrade' | 'repair' | 'uninstall';
export interface DeployOptions { readonly preserveConfig: boolean; readonly preserveData: boolean }

export interface DeploymentEvent {
  readonly eventId: string;
  readonly taskId: string;
  readonly nodeId: string;
  readonly component: DeployComponent;
  readonly step: ComponentDeployStatus['step'];
  readonly status: ComponentDeployStatus['status'];
  readonly progress: number;
  readonly message: string;
  readonly timestamp: string;
}

export interface ComponentDeployStatus {
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly nodeId: string;
  readonly component: DeployComponent;
  readonly operation: DeployOperation;
  readonly step: 'queued' | 'prechecking' | 'downloading' | 'verifying_package' | 'installing' | 'configuring' | 'restarting' | 'postchecking' | 'done';
  readonly status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  readonly message: string;
  readonly progress: number;
  readonly actorRole: 'admin' | 'operator' | 'viewer';
  readonly options: DeployOptions;
  readonly createdAt: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly beforeVersion?: string;
  readonly afterVersion?: string;
  readonly retryOf?: string;
  readonly errorCode?: string;
}

// ── SSH target + transport ────────────────────────────────────────────
export interface SshTarget {
  readonly local?: boolean;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly secret: string;
  readonly agentPort: number;
  readonly kernels: readonly NodeKernelConfig[];
  readonly ssh: {
    readonly host: string;
    readonly user: string;
    readonly port: number;
    readonly authMethod: 'password' | 'privateKey';
    readonly password?: string;
    readonly privateKey?: string;
    hostKey: string;
  };
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface DeploymentConnection {
  run(command: string, input?: string): Promise<ExecResult>;
  end(): void;
}

export interface DeploymentServiceOptions {
  readonly runLocal?: (command: string, input?: string) => Promise<ExecResult>;
}
