import { defineConfig, devices } from '@playwright/test'

const PORT = 3201

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node --import tsx src/server/index.ts', // `npm run test:e2e` recreates the database and builds the front-end first
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://tablero:tablero@localhost:54330/tablero_e2e' },
  },
})
