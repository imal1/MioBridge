export interface Config {
  singBoxConfigs: string[];
  mihomoPath: string;
  clashFilename: string;
  staticDir: string;
  logDir: string;
  backupDir: string;
  requestTimeout: number;
}

export type ActorRole = 'admin' | 'operator' | 'viewer';

export interface SubscriptionPolicyConfig {
  enabled?: boolean;
  cron?: string;
  freshness_hours?: number;
  node_drop_percent?: number;
  retry_delays_minutes?: number[];
  backup_retention?: number;
}

export interface DeploymentPolicyConfig {
  concurrency?: number;
  ssh_timeout_ms?: number;
  task_timeout_ms?: number;
  task_retention_days?: number;
}

export interface NotificationWebhookConfig {
  enabled?: boolean;
  url?: string;
  events?: string[];
}

export interface FullConfig {
  app?: {
    name?: string; version?: string; environment?: string; port?: number;
    public_base_url?: string; log_level?: string; timezone?: string;
  };
  network?: { request_timeout?: number };
  protocols?: { sing_box_configs?: string[] };
  binaries?: { mihomo_path?: string; sing_box_path?: string; xray_path?: string; v2ray_path?: string };
  directories?: { data_dir?: string; log_dir?: string; backup_dir?: string };
  subscription?: SubscriptionPolicyConfig & { clash_filename?: string };
  deployment?: DeploymentPolicyConfig;
  notifications?: { webhook?: NotificationWebhookConfig };
  logs?: { level?: string; task_retention_days?: number };
  [key: string]: unknown;
}

export interface ConfigValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ConfigValidationIssue[];
}

export interface ConfigApplyResult {
  readonly path: string;
  readonly value: unknown;
  readonly applied: boolean;
  readonly restartRequired: boolean;
  readonly backupPath?: string;
}

export interface ConfigFieldDefinition {
  readonly path: string;
  readonly type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  readonly restartRequired: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly allowed?: readonly string[];
}
