// Global test setup for Node environment tests (services, middleware, adapters)
// This file runs before each test suite

import { beforeAll } from 'vitest';

beforeAll(() => {
  // Ensure test environment has required env vars
  process.env.NODE_ENV = 'test';
});
