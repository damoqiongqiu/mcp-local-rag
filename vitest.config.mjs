import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Process management improvements
    testTimeout: 10000,
    teardownTimeout: 5000,     // Teardown timeout 5 seconds
    pool: 'forks',             // Use forks instead of threads for onnxruntime-node compatibility
    maxWorkers: 1,             // Single process execution to avoid onnxruntime-node threading issues
    isolate: false,            // Disabled for onnxruntime-node compatibility (re-init crashes in isolated contexts)
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/tmp/**',
    ],
    // Coverage — v8 provider because istanbul cannot handle ESM + isolate: false
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.int.test.ts',
        'src/**/*.e2e.test.ts',
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 65,
        statements: 70,
      },
    },
  },
})
