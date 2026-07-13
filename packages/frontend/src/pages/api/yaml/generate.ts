import type { NextApiRequest, NextApiResponse } from 'next';
import { yamlService } from '@/server/services/yamlService';
import { logger } from '@/server/utils/logger';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: '仅支持 POST' });
    return;
  }
  try {
    const { templatePath, outputPath } = req.body || {};
    if (!templatePath || typeof templatePath !== 'string') {
      res.status(400).json({ success: false, message: '请提供模板文件路径 (templatePath)' });
      return;
    }
    const result = yamlService.generateConfig(templatePath, outputPath);
    res.json({ success: result, message: result ? '配置文件生成成功' : '配置文件生成失败' });
  } catch (error) {
    logger.error('生成配置文件失败:', error);
    res.status(500).json({ success: false, message: '生成配置文件过程中发生错误' });
  }
}
