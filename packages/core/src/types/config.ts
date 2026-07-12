export interface Config {
  port: number;
  singBoxConfigs: string[];
  mihomoPath: string;
  clashFilename: string;
  staticDir: string;
  logDir: string;
  backupDir: string;
  autoUpdateCron: string;
  nginxPort: number;
  maxRetries: number;
  requestTimeout: number;
}

export interface FullConfig {
  app?: { name?: string; version?: string; environment?: string; port?: number };
  logging?: { level?: string };
  cors?: { origin?: string };
  network?: { nginx_port?: number; nginx_proxy_port?: number; max_retries?: number; request_timeout?: number };
  external?: { host?: string };
  protocols?: { sing_box_configs?: string[] };
  binaries?: { mihomo_path?: string; sing_box_path?: string; bun_path?: string };
  directories?: { base_dir?: string; data_dir?: string; log_dir?: string; backup_dir?: string; dist_dir?: string };
  automation?: { auto_update_cron?: string };
  [key: string]: unknown;
}
