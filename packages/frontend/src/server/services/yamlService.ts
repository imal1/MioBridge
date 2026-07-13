// 简化的 YAML 配置服务
// 只提供配置文件生成和验证功能

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { getMioBridgeBaseDir } from '../runtimePaths';

export { getMioBridgeBaseDir } from '../runtimePaths';

export class YamlService {
    private static instance: YamlService;

    public static getInstance(): YamlService {
        if (!YamlService.instance) {
            YamlService.instance = new YamlService();
        }
        return YamlService.instance;
    }

    private constructor() {}

    /**
     * 获取配置文件路径
     */
    private getConfigPath(): string {
        return path.join(getMioBridgeBaseDir(), 'config.yaml');
    }

    /**
     * 获取 yq 工具路径
     */
    private getYqPath(): string {
        return path.join(getMioBridgeBaseDir(), 'bin', 'yq');
    }

    /**
     * 获取基础目录
     */
    private getSubscriptionBaseDir(): string {
        return getMioBridgeBaseDir();
    }

    /**
     * 验证 YAML 文件是否有效
     */
    validateConfig(): boolean {
        try {
            const configPath = this.getConfigPath();
            const yqPath = this.getYqPath();
            
            if (!fs.existsSync(configPath)) {
                logger.error(`配置文件不存在: ${configPath}`);
                return false;
            }
            
            if (!fs.existsSync(yqPath)) {
                logger.error(`yq 工具不存在: ${yqPath}`);
                return false;
            }
            
            // 使用 yq 验证 YAML 语法
            execSync(`"${yqPath}" eval '.' "${configPath}"`, { 
                stdio: 'pipe',
                encoding: 'utf8'
            });
            
            logger.info('YAML 配置文件验证成功');
            return true;
        } catch (error) {
            logger.error('YAML 配置文件验证失败:', error);
            return false;
        }
    }

    /**
     * 生成 YAML 配置文件
     */
    generateConfig(templatePath: string, outputPath?: string): boolean {
        try {
            const configPath = outputPath || this.getConfigPath();
            const yqPath = this.getYqPath();
            
            if (!fs.existsSync(templatePath)) {
                throw new Error(`模板文件不存在: ${templatePath}`);
            }
            
            if (!fs.existsSync(yqPath)) {
                throw new Error(`yq 工具不存在: ${yqPath}`);
            }
            
            // 确保输出目录存在
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            // 复制模板文件
            fs.copyFileSync(templatePath, configPath);
            
            // 使用基础路径更新配置
            const baseDir = this.getSubscriptionBaseDir();
            const dataDir = path.join(baseDir, 'www');
            const logDir = path.join(baseDir, 'log');
            const distDir = path.join(baseDir, 'dist');
            const mihomoPath = path.join(baseDir, 'bin');
            const bunPath = path.join(baseDir, 'bin');
            
            // 更新目录配置
            execSync(`"${yqPath}" eval '.directories.base_dir = "${baseDir}"' -i "${configPath}"`);
            execSync(`"${yqPath}" eval '.directories.data_dir = "${dataDir}"' -i "${configPath}"`);
            execSync(`"${yqPath}" eval '.directories.log_dir = "${logDir}"' -i "${configPath}"`);
            execSync(`"${yqPath}" eval '.directories.dist_dir = "${distDir}"' -i "${configPath}"`);
            execSync(`"${yqPath}" eval '.binaries.mihomo_path = "${mihomoPath}"' -i "${configPath}"`);
            execSync(`"${yqPath}" eval '.binaries.bun_path = "${bunPath}"' -i "${configPath}"`);
            
            logger.info(`YAML 配置文件已生成: ${configPath}`);
            return true;
        } catch (error) {
            logger.error('生成 YAML 配置文件失败:', error);
            return false;
        }
    }

    /**
     * 获取完整配置
     */
    getFullConfig(): any {
        try {
            const configPath = this.getConfigPath();
            const yqPath = this.getYqPath();
            
            if (!fs.existsSync(configPath)) {
                logger.warn('配置文件不存在，返回空配置');
                return {};
            }
            
            if (!fs.existsSync(yqPath)) {
                logger.warn('yq 工具不存在，返回空配置');
                return {};
            }
            
            // 使用 yq 将 YAML 转换为 JSON
            const result = execSync(`"${yqPath}" eval '.' "${configPath}" --output-format=json`, { 
                stdio: 'pipe',
                encoding: 'utf8'
            });
            
            // 解析 JSON
            const config = JSON.parse(result);
            return config;
        } catch (error) {
            logger.error('获取完整配置失败:', error);
            return {};
        }
    }

    /**
     * 检查配置文件是否存在
     */
    configExists(): boolean {
        const configPath = this.getConfigPath();
        return fs.existsSync(configPath);
    }

    /**
     * 获取基础目录（公共方法）
     */
    getBaseDir(): string {
        return this.getSubscriptionBaseDir();
    }

}

// 导出单例实例
export const yamlService = YamlService.getInstance();
