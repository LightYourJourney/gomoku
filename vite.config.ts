import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // 部署到子路径时用 `VITE_BASE=/gomoku/ yarn build`；默认根路径。
  // 写成构建期常量而不是运行时读 location：资源 URL 一旦生成就没法改，
  // 让产物自己知道它被放在哪，比运行时猜可靠。
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
