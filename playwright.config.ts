import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    browserName: 'chromium',
    channel: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined,
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
