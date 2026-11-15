import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = Number(process.env.HEALTH_TEST_PORT || 8018)
const python = process.env.HEALTH_TEST_PYTHON || '..\\.venv\\Scripts\\python.exe'

export default defineConfig({
  testDir: './tests/browser', timeout: 45000, expect: { timeout: 10000 }, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(chrome) ? chrome : undefined),
      args: process.env.BODY_SOFTWARE_RENDERING === '1' ? ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] : ['--enable-unsafe-swiftshader'] } },
  projects: [
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'phone-375', use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
    { name: 'phone-360', use: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true } },
    { name: 'phone-430', use: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: `"${python}" tests/browser/server.py`, url: `http://127.0.0.1:${port}/v1/health/ready`,
    reuseExistingServer: false, timeout: 60000 },
})
