// Next.js 服务端启动钩子。
// 仅在 Node runtime 下动态加载真正的初始化逻辑，避免 Edge 编译时解析 node 内建模块。
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
