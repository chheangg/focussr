import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@core': resolve(__dirname, 'src/core') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), mcp: resolve(__dirname, 'src/mcp/index.ts') } } },
  },
  preload: {},
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          hud: resolve(__dirname, 'src/renderer/hud.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
        },
      },
    },
  },
})
