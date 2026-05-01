import { readFileSync } from 'fs'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version?: string }

function toChunkPath(id: string): string {
  return id.replace(/\\/g, '/')
}

function manualVendorChunk(id: string): string | undefined {
  const normalizedId = toChunkPath(id)
  if (!normalizedId.includes('/node_modules/')) return undefined

  if (
    normalizedId.includes('/node_modules/vue/') ||
    normalizedId.includes('/node_modules/@vue/') ||
    normalizedId.includes('/node_modules/vue-router/') ||
    normalizedId.includes('/node_modules/pinia/')
  ) {
    return 'vue-vendor'
  }

  if (
    normalizedId.includes('/node_modules/vueuc/') ||
    normalizedId.includes('/node_modules/vooks/') ||
    normalizedId.includes('/node_modules/evtd/') ||
    normalizedId.includes('/node_modules/treemate/')
  ) {
    return 'naive-runtime'
  }
  if (
    normalizedId.includes('/node_modules/css-render/') ||
    normalizedId.includes('/node_modules/seemly/')
  ) {
    return 'naive-style'
  }

  if (
    normalizedId.includes('/node_modules/pdfjs-dist/build/') ||
    normalizedId.includes('/node_modules/pdfjs-dist/legacy/build/')
  ) {
    return 'pdfjs-core'
  }
  if (
    normalizedId.includes('/node_modules/pdfjs-dist/web/') ||
    normalizedId.includes('/node_modules/pdfjs-dist/legacy/web/')
  ) {
    return 'pdfjs-web'
  }
  if (normalizedId.includes('/node_modules/vue-pdf-embed/')) {
    return 'pdf-viewer'
  }

  if (
    normalizedId.includes('/node_modules/markdown-it/') ||
    normalizedId.includes('/node_modules/linkify-it/') ||
    normalizedId.includes('/node_modules/mdurl/')
  ) {
    return 'markdown-core'
  }
  if (normalizedId.includes('/node_modules/highlight.js/')) {
    return 'syntax-highlight'
  }
  if (normalizedId.includes('/node_modules/katex/')) {
    return 'math-rendering'
  }

  if (
    normalizedId.includes('/node_modules/@xterm/xterm/') ||
    normalizedId.includes('/node_modules/@xterm/addon-fit/') ||
    normalizedId.includes('/node_modules/@xterm/addon-web-links/')
  ) {
    return 'terminal-vendor'
  }

  if (normalizedId.includes('/node_modules/@fortawesome/')) {
    return 'icon-vendor'
  }

  return undefined
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appVersion = packageJson.version || ''
  
  const backendPort = env.PORT || '3000'
  const frontendPort = env.DEV_PORT || '3001'
  
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: parseInt(String(frontendPort)),
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          // SSE 流式响应需要禁用缓冲
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              // 对于 SSE 响应，禁用代理缓冲
              if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
                proxyRes.headers['cache-control'] = 'no-cache'
                proxyRes.headers['x-accel-buffering'] = 'no'
              }
            })
          },
        },
      },
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: manualVendorChunk,
        },
      },
    },
    define: {
      'import.meta.env.VITE_APP_TITLE': JSON.stringify(env.VITE_APP_TITLE || 'CrawClaw Web'),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
  }
})
