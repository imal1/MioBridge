import type { NextApiRequest, NextApiResponse } from 'next';
import { mihomoAdapter } from '@/server/core';
import { logger } from '@/server/utils/logger';
import type { ApiResponse } from '@/server/types';

export const config = { maxDuration: 120 };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  try {
        const mihomoHealthy = await mihomoAdapter.checkHealth();
    if (!mihomoHealthy) {
      res.status(503).json({
        success: false,
        error: 'Mihomo服务不可用',
        message: '请检查mihomo服务配置和状态',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const testNodes = [
      'vless://2df7ca47-b52d-4108-8db7-ca36049d7e83@104.234.37.101:43911?encryption=none&security=reality&flow=&type=h2&sni=aws.amazon.com&pbk=EMUKRSbFWEK8nju9E56Z4NsUrduOXZE7qtZwZRdOTwI&fp=chrome#test-vless',
      'hysteria2://23f75240-12d3-4fdb-8ea4-f1060b5ced8f@104.234.37.101:33911?alpn=h3&insecure=1#test-hysteria2',
      'trojan://6d483d0f-b61d-45d7-a37a-afb927367f18@104.234.37.101:55458?type=tcp&security=tls&allowInsecure=1#test-trojan',
      'tuic://3078f955-f4ab-481e-ac54-991582a0bde5:3078f955-f4ab-481e-ac54-991582a0bde5@104.234.37.101:13911?alpn=h3&allow_insecure=1&congestion_control=bbr#test-tuic',
    ];

    const results: any = {
      timestamp: new Date().toISOString(),
      mihomoStatus: { healthy: mihomoHealthy },
      tests: [],
    };

    for (const testNode of testNodes) {
      const protocol = testNode.split('://')[0];
      logger.info(`测试单独转换协议: ${protocol}`);
      try {
        const clashContent = await mihomoAdapter.convertToClashByContent(testNode);
        const proxyMatches = clashContent.match(/- name:/g);
        const proxyCount = proxyMatches ? proxyMatches.length : 0;

        const lines = clashContent.split('\n');
        let outputType = 'unknown';
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('type:')) {
            outputType = trimmedLine.replace('type:', '').trim();
            break;
          }
        }

        results.tests.push({
          protocol,
          input: testNode.substring(0, 100) + '...',
          success: true,
          proxyCount,
          outputType,
          contentLength: clashContent.length,
          preview: clashContent.substring(0, 200) + '...',
        });
      } catch (error: any) {
        results.tests.push({
          protocol,
          input: testNode.substring(0, 100) + '...',
          success: false,
          error: error.message,
          errorDetails: error.stack,
        });
        logger.error(`${protocol} 转换失败: ${error.message}`);
      }
    }

    try {
      const allNodesContent = testNodes.join('\n');
      const allClashContent = await mihomoAdapter.convertToClashByContent(allNodesContent);
      const allProxyMatches = allClashContent.match(/- name:/g);
      const allProxyCount = allProxyMatches ? allProxyMatches.length : 0;

      const allOutputTypes: { [key: string]: number } = {};
      for (const line of allClashContent.split('\n')) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('type:')) {
          const type = trimmedLine.replace('type:', '').trim();
          allOutputTypes[type] = (allOutputTypes[type] || 0) + 1;
        }
      }

      results.combinedTest = {
        success: true,
        inputCount: testNodes.length,
        outputCount: allProxyCount,
        outputTypes: allOutputTypes,
        contentLength: allClashContent.length,
        preview: allClashContent.substring(0, 500) + '...',
      };
    } catch (error: any) {
      results.combinedTest = { success: false, error: error.message, errorDetails: error.stack };
      logger.error(`组合转换失败: ${error.message}`);
    }

    res.json({ success: true, data: results, message: '多协议转换测试完成', timestamp: new Date().toISOString() });
  } catch (error: any) {
    logger.error('多协议测试API错误:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
