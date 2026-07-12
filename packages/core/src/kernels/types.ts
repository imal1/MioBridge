export const KERNEL_TYPES = ['sing-box', 'xray', 'v2ray'] as const;
export type KernelType = typeof KERNEL_TYPES[number];
export interface KernelAdapter {
  readonly type: KernelType;
  getConfigPaths(): Promise<string[]>;
  extractNodeUrls(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}
