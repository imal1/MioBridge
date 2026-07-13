import { Config } from '../types';
import * as path from 'path';
import { yamlService } from '../services/yamlService';
import { VERSION } from '../version';

// 直接导出 yamlService 实例，供其他模块使用
export { yamlService };

// 获取完整配置（直接复用 yamlService）
export const getFullConfig = () => {
    return yamlService.getFullConfig();
};

// 获取应用环境
export const getAppEnvironment = (): string => {
    const fullConfig = yamlService.getFullConfig();
    return fullConfig?.app?.environment || 'production';
};

// 获取应用版本
export const getAppVersion = (): string => {
    const fullConfig = yamlService.getFullConfig();
    return fullConfig?.app?.version || VERSION;
};

// 获取日志级别
export const getLogLevel = (): string => {
    const fullConfig = yamlService.getFullConfig();
    return fullConfig?.logging?.level || 'info';
};

// 获取 CORS 源
export const getCorsOrigin = (): string => {
    const fullConfig = yamlService.getFullConfig();
    return fullConfig?.cors?.origin || '*';
};

// 根据路径获取配置项
export const getConfigByPath = (path: string): any => {
    const fullConfig = yamlService.getFullConfig();
    const pathParts = path.split('.');
    let current = fullConfig;
    
    for (const part of pathParts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return null;
        }
    }
    
    return current;
};

// 获取前端所需的配置
export const getFrontendConfig = () => {
    const fullConfig = yamlService.getFullConfig();
    if (!fullConfig) {
        // 默认配置
        return {
            app: {
                name: 'miobridge',
                version: VERSION,
                environment: 'production'
            },
            network: {
                nginx_port: 3080,
                nginx_proxy_port: 3888
            },
            external: {
                host: 'localhost'
            },
            protocols: {
                sing_box_configs: ['vless', 'hysteria2', 'trojan', 'tuic', 'vmess']
            },
            cors: {
                origin: '*'
            }
        };
    }
    
    return {
        app: fullConfig.app,
        network: fullConfig.network,
        external: fullConfig.external,
        protocols: fullConfig.protocols,
        cors: fullConfig.cors
    };
};

// 导出主配置对象（直接复用 yamlService）
export const config: Config = (() => {
    const fullConfig = yamlService.getFullConfig();
    const baseDir = yamlService.getBaseDir();
    
    if (fullConfig) {
        return {
            port: fullConfig.app?.port || 3000,
            singBoxConfigs: fullConfig.protocols?.sing_box_configs || ['vless-reality', 'hysteria2', 'trojan', 'tuic', 'vmess'],
            mihomoPath: fullConfig.binaries?.mihomo_path || path.join(baseDir, 'bin'),
            clashFilename: 'clash.yaml',
            staticDir: fullConfig.directories?.data_dir || path.join(baseDir, 'www'),
            logDir: fullConfig.directories?.log_dir || path.join(baseDir, 'log'),
            backupDir: fullConfig.directories?.backup_dir || path.join(baseDir, 'backup'),
            autoUpdateCron: fullConfig.automation?.auto_update_cron || '0 */2 * * *',
            nginxPort: fullConfig.network?.nginx_port || 3080,
            maxRetries: fullConfig.network?.max_retries || 3,
            requestTimeout: fullConfig.network?.request_timeout || 30000
        };
    }
    
    // 默认配置
    return {
        port: 3000,
        singBoxConfigs: ['vless-reality', 'hysteria2', 'trojan', 'tuic', 'vmess'],
        mihomoPath: path.join(baseDir, 'bin'),
        clashFilename: 'clash.yaml',
        staticDir: path.join(baseDir, 'www'),
        logDir: path.join(baseDir, 'log'),
        backupDir: path.join(baseDir, 'backup'),
        autoUpdateCron: '0 */2 * * *',
        nginxPort: 3080,
        maxRetries: 3,
        requestTimeout: 30000
    };
})();

// 配置验证函数
export const validateConfig = (): void => {
    const requiredFields: (keyof Config)[] = ['port', 'singBoxConfigs'];
    
    for (const field of requiredFields) {
        if (!config[field]) {
            throw new Error(`配置字段 ${field} 是必需的`);
        }
    }
    
    if (config.singBoxConfigs.length === 0) {
        throw new Error('至少需要配置一个sing-box配置名称');
    }
};

// 默认导出
export default config;