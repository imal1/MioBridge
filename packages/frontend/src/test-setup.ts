// Global test setup. This file runs before each test suite.

import { beforeAll, vi } from 'vitest';

// @iconify/react 在挂载后异步向 Iconify API 取图标，并用定时器把结果写回组件状态。
// 单元测试不该依赖外部网络；更糟的是，这个定时器可能在该测试文件的 jsdom 环境销毁之后才触发，
// 此时 React 的 setState 会抛出 `window is not defined`，被 Vitest 记为未处理错误而让整次运行失败
// （是否触发取决于网络耗时，因此表现为偶发）。图标对这些测试没有意义，统一替换为空组件。
vi.mock('@iconify/react', () => ({ Icon: () => null }));

beforeAll(() => {
  // Ensure test environment has required env vars
  process.env.NODE_ENV = 'test';
});
