import * as fs from 'fs-extra';
import * as path from 'path';
import { Config, StatusInfo, UpdateResult } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SingBoxService } from './singBoxService';
import { MihomoService } from './mihomoService';
import { YamlService } from './yamlService';
import { VERSION, GIT_COMMIT, BUILD_TIME } from '../version';
import {
    buildClashSubscriptionResult,
    dedupeProxySources,
    type CollectedProxySource,
} from './proxySources';

export class MioBridgeService {
    private static instance: MioBridgeService;
    private singBoxService: Pick<SingBoxService, 'checkSingBoxAvailable' | 'getAllConfigUrls'>;
    private mihomoService: Pick<MihomoService, 'checkHealth' | 'convertToClashByContent' | 'getVersion'>;
    private yamlService: YamlService;
    private updateConfig?: Pick<Config, 'staticDir' | 'logDir' | 'backupDir' | 'clashFilename'>;
    private collectRemoteSources?: () => Promise<{ sources: CollectedProxySource[]; errors: string[] }>;
    
    public static getInstance(): MioBridgeService {
        if (!MioBridgeService.instance) {
            MioBridgeService.instance = new MioBridgeService();
        }
        return MioBridgeService.instance;
    }

    constructor(overrides: {
        singBoxService?: Pick<SingBoxService, 'checkSingBoxAvailable' | 'getAllConfigUrls'>;
        mihomoService?: Pick<MihomoService, 'checkHealth' | 'convertToClashByContent' | 'getVersion'>;
        updateConfig?: Pick<Config, 'staticDir' | 'logDir' | 'backupDir' | 'clashFilename'>;
        collectRemoteSources?: () => Promise<{ sources: CollectedProxySource[]; errors: string[] }>;
    } = {}) {
        this.singBoxService = overrides.singBoxService ?? SingBoxService.getInstance();
        this.mihomoService = overrides.mihomoService ?? MihomoService.getInstance();
        this.yamlService = YamlService.getInstance();
        this.updateConfig = overrides.updateConfig;
        this.collectRemoteSources = overrides.collectRemoteSources;
    }

    /**
     * 确保所有必要目录存在
     */
    async ensureDirectories(): Promise<void> {
        const runtimeConfig = this.updateConfig ?? config;
        await fs.ensureDir(runtimeConfig.staticDir);
        await fs.ensureDir(runtimeConfig.logDir);
        await fs.ensureDir(runtimeConfig.backupDir);
        logger.info('目录检查完成');
    }

    /**
     * 更新订阅
     */
    async updateSubscription(): Promise<UpdateResult> {
        try {
            logger.info('开始更新订阅...');
            const runtimeConfig = this.updateConfig ?? config;

            const collectedSources: CollectedProxySource[] = [];
            const errors: string[] = [];

            try {
                const singBoxAvailable = await this.singBoxService.checkSingBoxAvailable();
                if (singBoxAvailable) {
                    const localResult = await this.singBoxService.getAllConfigUrls();
                    collectedSources.push(...localResult.urls.map(url => ({
                        url,
                        kernel: 'sing-box' as const,
                        nodeId: 'local',
                        location: '本机',
                    })));
                    errors.push(...localResult.errors.map(error => `本机: ${error}`));
                } else {
                    errors.push('本机: Sing-box不可用，跳过本机节点源');
                }
            } catch (error) {
                errors.push(`本机来源收集失败: ${error instanceof Error ? error.message : String(error)}`);
            }

            try {
                const remoteResult = this.collectRemoteSources
                    ? await this.collectRemoteSources()
                    : await (await import('./nodeManager')).NodeManager.getInstance().collectRemoteNodeSources();
                collectedSources.push(...remoteResult.sources);
                errors.push(...remoteResult.errors.map(error => `远端: ${error}`));
            } catch (error) {
                errors.push(`远端来源收集失败: ${error instanceof Error ? error.message : String(error)}`);
            }

            // 从原始URLs中提取纯净的代理URL
            const validProxyProtocols = ['vless://', 'vmess://', 'ss://', 'ssr://', 'trojan://', 'hysteria2://', 'tuic://', 'wireguard://'];
            const extractedSources: CollectedProxySource[] = [];
            const protocolStats: { [key: string]: number } = {};
            
            for (const source of collectedSources) {
                // 移除ANSI颜色代码 - 使用字符代码27 (ESC)
                const ansiRegex = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
                const cleanUrl = source.url.replace(ansiRegex, '');
                
                // 将内容按行分割
                const lines = cleanUrl.split('\n');
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    
                    // 跳过空行
                    if (!trimmedLine) continue;
                    
                    // 检查是否是有效的代理URL
                    const matchedProtocol = validProxyProtocols.find(protocol => trimmedLine.startsWith(protocol));
                    
                    if (matchedProtocol) {
                        const isVmess = matchedProtocol === 'vmess://';
                        // URL 协议通常包含 authority；VMess 则是 Base64 JSON。
                        if ((isVmess || (trimmedLine.includes('@') && trimmedLine.includes(':'))) && trimmedLine.length > 20) {
                            extractedSources.push({ ...source, url: trimmedLine });
                            
                            // 统计协议类型
                            const protocolName = matchedProtocol.replace('://', '');
                            protocolStats[protocolName] = (protocolStats[protocolName] || 0) + 1;
                            
                            logger.info(
                                `提取到有效代理URL [${protocolName}]，来源 ${source.nodeId}/${source.kernel}`,
                            );
                        }
                    }
                }
            }
            
            const dedupedSources = dedupeProxySources(extractedSources);
            logger.info(`URL提取结果: 从${collectedSources.length}个原始条目中提取出${dedupedSources.length}个有效代理URL`);
            logger.info(`协议分布统计: ${JSON.stringify(protocolStats, null, 2)}`);
            
            if (dedupedSources.length === 0) {
                throw new Error(`没有找到有效的代理URL。来源错误: ${errors.join('; ') || '无可用节点源'}`);
            }

            // 仅在确认有新内容后创建目录和写入，避免全来源失败时替换旧产物。
            await this.ensureDirectories();

            // 原始订阅保持来源 URL 不变；坏的 Clash 命名来源仍保留在 raw/Base64 产物中。
            const rawContent = dedupedSources.map(source => source.url).join('\n');
            const encodedContent = Buffer.from(rawContent).toString('base64');

            // 保存文件
            const subscriptionFile = path.join(runtimeConfig.staticDir, 'subscription.txt');
            const rawFile = path.join(runtimeConfig.staticDir, 'raw.txt');

            await fs.writeFile(subscriptionFile, encodedContent, 'utf8');
            await fs.writeFile(rawFile, rawContent, 'utf8');

            logger.info(`订阅文件已保存: ${subscriptionFile}`);

            const clashSubscription = buildClashSubscriptionResult(dedupedSources);
            errors.push(...clashSubscription.errors);

            // 生成Clash配置 - 通过 mihomoService 生成 YAML
            let clashGenerated = false;
            let clashError: string | null = null;
            try {
                const mihomoAvailable = await this.mihomoService.checkHealth();
                if (!mihomoAvailable) {
                    throw new Error('Mihomo服务未运行或不可访问');
                }
                if (!clashSubscription.content) {
                    throw new Error('没有可用于生成 Clash 配置的代理来源');
                }
                logger.info(`开始生成Clash配置，使用订阅内容直接转换，内容长度: ${clashSubscription.content.length} 字符`);
                
                // 使用 mihomoService 将订阅内容转换为 Clash 配置
                const clashContent = await this.mihomoService.convertToClashByContent(clashSubscription.content);
                
                // 验证转换结果
                if (!clashContent || !clashContent.includes('proxies:')) {
                    throw new Error('转换结果不包含有效的代理配置');
                }
                
                const proxyMatches = clashContent.match(/- name:/g);
                const proxyCount = proxyMatches ? proxyMatches.length : 0;
                logger.info(`使用 mihomo 转换成功，生成 ${proxyCount} 个代理节点`);
                
                // 保存 Clash 配置文件
                const clashFile = path.join(runtimeConfig.staticDir, runtimeConfig.clashFilename);
                await fs.writeFile(clashFile, clashContent, 'utf8');
                
                // 验证文件是否成功写入
                const fileExists = await fs.pathExists(clashFile);
                const fileStats = fileExists ? await fs.stat(clashFile) : null;
                
                if (fileExists && fileStats && fileStats.size > 0) {
                    clashGenerated = true;
                    logger.info(`Clash配置生成成功，文件大小: ${fileStats.size} 字节`);
                } else {
                    throw new Error('文件写入失败或文件为空');
                }
            } catch (error: any) {
                clashError = error.message;
                logger.error('生成Clash配置失败:', error.message);
                logger.error('错误详情:', error);
            }

            // 创建备份
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const backupFile = path.join(runtimeConfig.backupDir, `subscription_${timestamp}.txt`);
            await fs.copy(subscriptionFile, backupFile);

            logger.info(`备份已创建: ${backupFile}`);

            const result: UpdateResult = {
                success: true,
                message: `订阅更新成功，共 ${dedupedSources.length} 个节点${clashGenerated ? '' : ' (Clash生成失败)'}`,
                timestamp: new Date().toISOString(),
                nodesCount: dedupedSources.length,
                clashGenerated,
                backupCreated: backupFile,
                warnings: errors.length > 0 ? errors : undefined,
                errors: clashError ? [`Clash生成失败: ${clashError}`] : undefined
            };

            logger.info(`订阅更新完成: ${dedupedSources.length} 个节点, Clash生成: ${clashGenerated}`);
            return result;

        } catch (error: any) {
            logger.error('更新订阅失败:', error);
            throw error;
        }
    }

    /**
     * 获取订阅状态信息
     */
    async getStatus(): Promise<StatusInfo> {
        const subscriptionFile = path.join(config.staticDir, 'subscription.txt');
        const clashFile = path.join(config.staticDir, config.clashFilename);
        const rawFile = path.join(config.staticDir, 'raw.txt');

        const status: StatusInfo = {
            subscriptionExists: await fs.pathExists(subscriptionFile),
            clashExists: await fs.pathExists(clashFile),
            rawExists: await fs.pathExists(rawFile),
            mihomoAvailable: await this.mihomoService.checkHealth(),
            uptime: process.uptime(),
            version: VERSION,
            gitCommit: GIT_COMMIT,
            buildTime: BUILD_TIME,
        };

        // 获取 mihomo 版本信息
        try {
            const mihomoVersion = await this.mihomoService.getVersion();
            status.mihomoVersion = mihomoVersion?.version || 'unknown';
        } catch (error) {
            logger.warn('获取 mihomo 版本失败:', error);
        }

        // 获取文件信息
        if (status.subscriptionExists) {
            const stats = await fs.stat(subscriptionFile);
            status.subscriptionLastUpdated = stats.mtime.toISOString();
            status.subscriptionSize = stats.size;
        }

        if (status.clashExists) {
            const stats = await fs.stat(clashFile);
            status.clashLastUpdated = stats.mtime.toISOString();
            status.clashSize = stats.size;
        }

        if (status.rawExists) {
            const content = await fs.readFile(rawFile, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            status.nodesCount = lines.length;
        }

        return status;
    }

    /**
     * 获取文件内容
     */
    async getFileContent(filename: string): Promise<Buffer> {
        const filePath = path.join(config.staticDir, filename);
        
        if (!(await fs.pathExists(filePath))) {
            // 如果是raw.txt文件不存在，尝试创建默认文件
            if (filename === 'raw.txt') {
                await this.createDefaultRawFile();
                logger.info(`已创建默认的 ${filename} 文件`);
            } else {
                throw new Error(`文件 ${filename} 不存在`);
            }
        }

        return await fs.readFile(filePath);
    }

    /**
     * 创建默认的raw.txt文件
     */
    private async createDefaultRawFile(): Promise<void> {
        const filePath = path.join(config.staticDir, 'raw.txt');
        const defaultContent = `# 原始订阅链接文件
# 请在此添加你的订阅链接，每行一个
# 示例:
# https://example.com/subscription1
# https://example.com/subscription2

`;
        
        await fs.ensureDir(config.staticDir);
        await fs.writeFile(filePath, defaultContent, 'utf8');
        logger.info(`已创建默认的raw.txt文件: ${filePath}`);
    }

    /**
     * 生成 YAML 文件
     * 使用 yamlService 生成指定的 YAML 配置文件
     */
    async generateYamlFile(templatePath: string, outputPath: string): Promise<boolean> {
        try {
            logger.info(`开始生成 YAML 文件: ${outputPath}`);
            
            const result = this.yamlService.generateConfig(templatePath, outputPath);
            
            if (result) {
                logger.info(`YAML 文件生成成功: ${outputPath}`);
            } else {
                logger.error(`YAML 文件生成失败: ${outputPath}`);
            }
            
            return result;
        } catch (error: any) {
            logger.error(`生成 YAML 文件失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 验证 YAML 文件
     * 使用 yamlService 验证 YAML 配置文件语法
     */
    async validateYamlFile(): Promise<boolean> {
        try {
            logger.info('开始验证 YAML 文件语法');
            
            const isValid = this.yamlService.validateConfig();
            
            if (isValid) {
                logger.info('YAML 文件语法验证通过');
            } else {
                logger.error('YAML 文件语法验证失败');
            }
            
            return isValid;
        } catch (error: any) {
            logger.error(`验证 YAML 文件失败: ${error.message}`);
            return false;
        }
    }
}
