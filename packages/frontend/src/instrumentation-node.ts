// 实际的服务端初始化逻辑（仅 Node runtime 加载）。
// 承担原 Express App.initialize() 的职责：初始化目录、健康检查、注册 cron 定时更新。
import cron from 'node-cron'
import * as fs from 'fs-extra'
import { config } from '@/server/config'
import { corePaths, mihomoAdapter, mioBridgeCore, singBoxAdapter } from '@/server/core'
import { logger } from '@/server/utils/logger'
import { NodeManager } from '@/server/services/nodeManager'

async function initialize() {
  try {
    logger.info('🚀 Next 服务端启动初始化...')

    await Promise.all([corePaths.dataDir, corePaths.logDir, corePaths.backupDir].map(directory => fs.ensureDir(directory)))
    logger.info('✅ 目录初始化完成')

    // Mihomo 状态检查（非阻塞）
    try {
      if (await mihomoAdapter.checkHealth()) {
        const version = await mihomoAdapter.getVersion()
        logger.info(`✅ Mihomo 可用 (版本: ${version?.version || 'unknown'})`)
      } else {
        logger.warn('⚠️  Mihomo 不可用，将在首次使用时检查')
      }
    } catch (error: any) {
      logger.warn('⚠️  Mihomo 检查失败:', error?.message)
    }

    // Sing-box 状态检查（非阻塞）
    try {
      const singBoxAvailable = await singBoxAdapter.isAvailable()
      logger.info(singBoxAvailable ? '✅ Sing-box 可用' : '⚠️  Sing-box 不可用')
    } catch (error: any) {
      logger.warn('⚠️  Sing-box 检查失败:', error?.message)
    }

    // NodeManager 多节点集群初始化（非阻塞）
    try {
      const nodeManager = NodeManager.getInstance()
      await nodeManager.loadNodes()
      nodeManager.startWatch()
      logger.info('✅ NodeManager 集群节点初始化完成（已启用热加载）')
    } catch (error: any) {
      logger.warn('⚠️  NodeManager 初始化失败:', error?.message)
    }

    // 注册定时自动更新
    if (config.autoUpdateCron) {
      cron.schedule(
        config.autoUpdateCron,
        async () => {
          logger.info('执行定时更新订阅...')
          try {
            const result = await mioBridgeCore.updateSubscription()
            logger.info(`定时更新完成: ${result.nodesCount} 个节点`)
          } catch (error: any) {
            logger.error('定时更新失败:', error)
          }
        },
        { timezone: 'Asia/Shanghai' }
      )
      logger.info(`⏰ 定时任务已启动: ${config.autoUpdateCron} (Asia/Shanghai)`)
    }

    logger.info('✅ 服务端初始化完成')
  } catch (error: any) {
    logger.error('❌ 服务端初始化失败:', error)
  }
}

void initialize()
