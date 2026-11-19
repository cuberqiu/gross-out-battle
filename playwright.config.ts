import { defineConfig } from '@playwright/test'

const port = 43991

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx tsx server/index.ts',
    url: `http://127.0.0.1:${port}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      COUNTDOWN_MS: '400',
      ROUND_MS: '30000',
      SYNC_QUESTION_MS: '8000',
      SYNC_RESULT_MS: '5000',
      SYNC_QUESTIONS: '3',
      MIXED_BATTLE_MS: '4000',
      MIXED_CYCLES: '1',
      RECONNECT_GRACE_MS: '2500',
    },
  },
})
