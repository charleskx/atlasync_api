import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/app.ts',
        'server.ts',
        'worker.ts',
        'src/db/migrations/**',
        'src/db/schema/**',
        'src/db/seed*.ts',
        'src/types/**',
        'src/config/**',
        'src/middlewares/**',
        'src/**/*.repository.ts',
        'src/**/*.routes.ts',
        'src/**/*.worker.ts',
        'src/queues/**',
        'src/modules/auth/auth.service.ts',
        'src/modules/geocoding/**',
        'src/modules/import/import.parser.ts',
        'src/shared/mailer.ts',
        'src/shared/sse-bus.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 55,
        functions: 80,
        lines: 85,
      },
    },
  },
})
