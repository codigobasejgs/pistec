import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'src', testMatch: '**/*.e2e.ts', fullyParallel: false, workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }], // Chrome instalado; download do Chromium falhou neste ambiente.
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 120000 },
});
