// 前端配置 API 客户端
// 替代 js-yaml 库，通过后端 API 获取配置

import { useState, useEffect } from 'react';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
  source?: string;
}

export interface FrontendConfig {
  app: {
    name: string;
    version: string;
    environment: string;
  };
  network: {
    nginx_port: number;
    nginx_proxy_port: number;
  };
  external: {
    host: string;
  };
  protocols: {
    sing_box_configs: string[];
  };
}

export interface YqInfo {
  yqPath: string;
  yqVersion: string;
  yqExists: boolean;
  configPath: string;
  configExists: boolean;
}

/**
 * 配置 API 客户端类
 */
export class ConfigApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * 获取前端所需的配置（推荐使用）
   */
  async getFrontendConfig(): Promise<FrontendConfig> {
    const response = await fetch(`${this.baseUrl}/api/yaml/frontend`);
    const result: ApiResponse<FrontendConfig> = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || '获取配置失败');
    }
    
    return result.data!;
  }

  /**
   * 获取完整配置
   */
  async getFullConfig(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/yaml/config`);
    const result: ApiResponse = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || '获取完整配置失败');
    }
    
    return result.data;
  }

  /**
   * 获取配置字段值（通过完整配置解析）
   * @param path - 字段路径，如 '.app.name', '.network.nginx_port'  
   */
  async parseField(path: string): Promise<any> {
    const fullConfig = await this.getFullConfig();
    const pathParts = path.replace(/^\./, '').split('.');
    let current = fullConfig;
    
    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }
    
    return current;
  }

  /**
   * 批量获取配置（通过完整配置解析）
   * @param fields - 字段映射，如 { appName: '.app.name', appPort: '.app.port' }
   */
  async getBatchConfig(fields: Record<string, string>): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    
    for (const [key, path] of Object.entries(fields)) {
      result[key] = await this.parseField(path);
    }
    
    return result;
  }

  /**
   * 验证 YAML 语法
   */
  async validateYaml(): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/api/yaml/validate`);
    const result: ApiResponse = await response.json();
    
    return result.success;
  }
}

/**
 * 默认配置客户端实例
 */
export const configApi = new ConfigApiClient();

/**
 * React Hook: 使用配置
 */
export function useConfig() {
  const [config, setConfig] = useState<FrontendConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    configApi.getFrontendConfig()
      .then(setConfig)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading, error, reload: () => {
    setLoading(true);
    setError(null);
    configApi.getFrontendConfig()
      .then(setConfig)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }};
}

/**
 * 辅助函数：获取应用名称
 */
export async function getAppName(): Promise<string> {
  return await configApi.parseField('.app.name');
}

/**
 * 辅助函数：获取应用版本
 */
export async function getAppVersion(): Promise<string> {
  return await configApi.parseField('.app.version');
}

/**
 * 辅助函数：获取支持的协议列表
 */
export async function getSupportedProtocols(): Promise<string[]> {
  return await configApi.parseField('.protocols.sing_box_configs');
}

/**
 * 使用示例：
 * 
 * // 基本使用
 * import { configApi } from './lib/configApi';
 * 
 * async function loadConfig() {
 *   try {
 *     const config = await configApi.getFrontendConfig();
 *     console.log('应用名称:', config.app.name);
 *     console.log('支持的协议:', config.protocols.sing_box_configs);
 *   } catch (error) {
 *     console.error('配置加载失败:', error.message);
 *   }
 * }
 * 
 * // React Hook 使用
 * function MyComponent() {
 *   const { config, loading, error } = useConfig();
 *   
 *   if (loading) return <div>加载配置中...</div>;
 *   if (error) return <div>配置加载失败: {error}</div>;
 *   
 *   return (
 *     <div>
 *       <h1>{config.app.name} v{config.app.version}</h1>
 *       <p>环境: {config.app.environment}</p>
 *       <p>支持的协议: {config.protocols.sing_box_configs.join(', ')}</p>
 *     </div>
 *   );
 * }
 * 
 * // 批量获取特定配置
 * async function getCustomConfig() {
 *   const config = await configApi.getBatchConfig({
 *     appInfo: '.app.name',
 *     serverPort: '.app.port',
 *     protocols: '.protocols.sing_box_configs'
 *   });
 *   console.log(config);
 * }
 */
