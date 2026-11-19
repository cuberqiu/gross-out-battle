import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 43123,
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:43124',
        ws: true,
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:43124',
        changeOrigin: true,
      },
      '/rt': {
        target: 'http://127.0.0.1:43124',
        changeOrigin: true,
        proxyTimeout: 30_000,
        timeout: 30_000,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
