import type { NextApiRequest, NextApiResponse } from 'next';
import { mioBridgeCore } from '@/server/core';
import { config as appConfig } from '@/server/config';
import { logger } from '@/server/utils/logger';

// 通过 rewrite 映射：/subscription.txt -> /api/file/subscription 等
const FILE_MAP: Record<string, { filename: string; contentType: string }> = {
  subscription: { filename: 'subscription.txt', contentType: 'text/plain; charset=utf-8' },
  clash: { filename: appConfig.clashFilename, contentType: 'text/yaml; charset=utf-8' },
  raw: { filename: 'raw.txt', contentType: 'text/plain; charset=utf-8' },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const name = String(req.query.name || '');
  const entry = FILE_MAP[name];

  if (!entry) {
    res.status(404).send('文件不存在');
    return;
  }

  try {
    const content = await mioBridgeCore.artifacts.getFileContent(entry.filename);
    res.setHeader('Content-Type', entry.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
    res.send(content);
  } catch (error: any) {
    if (name === 'raw') {
      logger.error(`获取原始链接文件失败: ${error.message}`, error);
      res.status(404).json({
        success: false,
        error: `获取原始链接失败: ${error.message}`,
        message: '请确保 raw.txt 文件存在于数据目录中',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    res.status(404).send(`获取文件失败: ${error.message}`);
  }
}
