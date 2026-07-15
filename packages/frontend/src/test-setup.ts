// Global test setup for Node environment tests (services, middleware, adapters)
// This file runs before each test suite

import React from 'react';
import { beforeAll, vi } from 'vitest';

// Iconify resolves icon data asynchronously. Rendering a stable test double
// prevents a late icon update from firing after jsdom has been torn down.
vi.mock('@iconify/react', () => ({
  Icon: ({ icon, className }: { icon: string; className?: string }) => React.createElement('span', {
    'aria-hidden': 'true',
    className,
    'data-icon': icon,
  }),
}));

beforeAll(() => {
  // Ensure test environment has required env vars
  process.env.NODE_ENV = 'test';
});
