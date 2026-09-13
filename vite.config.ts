import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { normalizeBasePath } from './shared/paths.ts'

export default defineConfig({
  base: normalizeBasePath(process.env.APP_BASE_PATH),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
