const path = require('path')
const { execSync } = require('child_process')

let gitCommit = 'unknown'
try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
} catch { /* not a git repo or git not available */ }

const isVercel = process.env.VERCEL === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 以独立 Node 服务运行（生产: node .next/standalone/frontend/server.js），支持 SSR
  // Vercel 托管部署使用平台自己的 Next.js builder，不生成 standalone 服务器。
  ...(isVercel ? {} : { output: 'standalone' }),
  // monorepo（bun workspace）下依赖被提升到仓库根 node_modules，
  // 显式指定 tracing 根，确保 standalone 正确打包依赖（否则会误选 ~ 目录）
  outputFileTracingRoot: path.join(__dirname, '..'),
  outputFileTracingIncludes: {
    '/*': ['./bin/mihomo'],
    '/api/*': ['./bin/mihomo'],
    '/api/**/*': ['./bin/mihomo'],
  },
  // 后端 service 层会 spawn 外部进程（mihomo/yq/sing-box），且 winston 等需在 Node 端运行
  serverExternalPackages: ['winston', 'fs-extra', 'node-cron'],
  // React 19.x 兼容性配置
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  },
  // 保持对外文件下载 URL 不变，映射到内部 API 路由
  async rewrites() {
    return [
      { source: '/subscription.txt', destination: '/api/file/subscription' },
      { source: '/clash.yaml', destination: '/api/file/clash' },
      { source: '/raw.txt', destination: '/api/file/raw' },
      { source: '/health', destination: '/api/health' }
    ]
  },
  // 注入构建时元数据，用于运行时展示版本和 commit
  env: {
    NEXT_PUBLIC_GIT_COMMIT: gitCommit,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
}

module.exports = nextConfig
