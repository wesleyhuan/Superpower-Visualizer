/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/start': 'http://localhost:3001',
      '/control': 'http://localhost:3001',
      '/observe': 'http://localhost:3001',
      '/new-agent': 'http://localhost:3001',
      '/sessions': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
  },
})
