import { exec } from 'child_process';
import { promisify } from 'util';
import { SingBoxResult } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export class SingBoxService {
    private static instance: SingBoxService;
    
    public static getInstance(): SingBoxService {
        if (!SingBoxService.instance) {
            SingBoxService.instance = new SingBoxService();
        }
        return SingBoxService.instance;
    }

    /**
     * 检查sing-box是否可用
     */
    async checkSingBoxAvailable(): Promise<boolean> {
        try {
            await execAsync('sing-box version', { timeout: config.requestTimeout });
            return true;
        } catch (error) {
            logger.error('Sing-box不可用:', error);
            return false;
        }
    }

    /**
     * 检查指定配置是否存在
     */
    async checkConfigExists(configName: string): Promise<boolean> {
        try {
            const { stderr } = await execAsync(`sing-box info ${configName}`, { timeout: config.requestTimeout });
            return !stderr || !stderr.includes('not found');
        } catch {
            return false;
        }
    }

    /**
     * 获取单个配置的URL
     */
    async getConfigUrl(configName: string): Promise<{ url?: string; error?: string }> {
        try {
            // 首先检查配置是否存在
            const exists = await this.checkConfigExists(configName);
            if (!exists) {
                return { error: `配置 ${configName} 不存在` };
            }

            const { stdout, stderr } = await execAsync(`sing-box url ${configName}`, { 
                timeout: config.requestTimeout 
            });

            if (stdout && stdout.trim()) {
                logger.info(`成功获取配置 ${configName}`);
                return { url: stdout.trim() };
            } else {
                return { error: `配置 ${configName} 获取失败: ${stderr || '无输出'}` };
            }
        } catch (error: any) {
            if (error.killed) {
                return { error: `配置 ${configName} 获取超时` };
            } else {
                return { error: `配置 ${configName} 获取异常: ${error.message}` };
            }
        }
    }

    /**
     * 获取所有配置的URL
     */
    async getAllConfigUrls(): Promise<SingBoxResult> {
        const urls: string[] = [];
        const errors: string[] = [];

        logger.info(`开始获取 ${config.singBoxConfigs.length} 个配置的URL...`);

        for (const configName of config.singBoxConfigs) {
            const result = await this.getConfigUrl(configName);
            
            if (result.url) {
                urls.push(result.url);
            } else if (result.error) {
                errors.push(result.error);
                logger.warn(result.error);
            }
        }

        logger.info(`URL获取完成: 成功 ${urls.length} 个, 失败 ${errors.length} 个`);
        return { urls, errors };
    }

    /**
     * 获取配置信息
     */
    async getConfigInfo(configName: string): Promise<string> {
        try {
            const { stdout } = await execAsync(`sing-box info ${configName}`, { timeout: config.requestTimeout });
            return stdout || '无配置信息';
        } catch (error: any) {
            throw new Error(`获取配置信息失败: ${error.message}`);
        }
    }

    /**
     * 列出所有可用配置
     */
    async listConfigs(): Promise<string[]> {
        try {
            const { stdout } = await execAsync('sing-box', { timeout: config.requestTimeout });
            // 解析输出获取配置列表 (需要根据实际输出格式调整)
            const _lines = stdout.split('\n');
            const _configs: string[] = [];
            
            // 这里需要根据sing-box的实际输出格式来解析
            // 临时返回配置的配置列表
            return config.singBoxConfigs;
        } catch (error: any) {
            logger.error('列出配置失败:', error);
            return config.singBoxConfigs;
        }
    }
}