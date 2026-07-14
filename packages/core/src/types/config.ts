export interface Config {
  singBoxConfigs: string[];
  mihomoPath: string;
  clashFilename: string;
  staticDir: string;
  logDir: string;
  backupDir: string;
  requestTimeout: number;
}

export interface FullConfig {
  app?: { name?: string; version?: string; environment?: string; port?: number };
  network?: { request_timeout?: number };
  protocols?: { sing_box_configs?: string[] };
  binaries?: { mihomo_path?: string; sing_box_path?: string };
  directories?: { data_dir?: string; log_dir?: string; backup_dir?: string };
  [key: string]: unknown;
}
