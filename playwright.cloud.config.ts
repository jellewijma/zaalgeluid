import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir: './cloud-tests',
  testMatch: '*.spec.ts',
  outputDir: '.checks/cloud-browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: (process.env.CLOUD_TEST_BASE_URL || 'http://localhost:4173/play-audio/').replace(/\/?$/, '/'),
    browserName: 'chromium',
    channel: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined,
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] },
    // Authentication values must never be recorded in browser traces.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
})
