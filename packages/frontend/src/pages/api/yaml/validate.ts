import type { NextApiRequest, NextApiResponse } from 'next';
import { yamlService } from '@/server/services/yamlService';
import { logger } from '@/server/utils/logger';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const isValid = yamlService.validateConfig();
    res.json({
      success: true,
      valid: isValid,
      message: isValid ? 'YAML 配置文件语法正确' : 'YAML 配置文件语法错误',
    });
  } catch (error) {
    logger.error('验证 YAML 文件失败:', error);
    res.status(500).json({ success: false, message: '验证过程中发生错误' });
  }
}
