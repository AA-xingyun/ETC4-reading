import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@features': resolve(__dirname, 'src/features'),
    },
  },
  test: {
    // 隔离本机凭据与缓存（见 tests/setup.ts）
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks',
  },
});
