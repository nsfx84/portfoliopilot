import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiPricesModuleUrl = pathToFileURL(path.join(__dirname, 'api', 'prices.js')).href

/**
 * Dev: handle GET /api/prices before Vite html fallback rewrites SPA routes.
 * stack.unshift runs this first. Browsers must send Accept: application/json (not the fetch default that looks like a wildcard for HTML).
 */
function pricesApiDevPlugin() {
  return {
    name: 'portfoliopilot-prices-api-dev',
    enforce: 'pre',
    configureServer(server) {
      const handler = async (req, res, next) => {
        let pathname
        try {
          pathname = new URL(req.url || '/', 'http://dev.local').pathname
        } catch {
          next()
          return
        }
        if (pathname !== '/api/prices') {
          next()
          return
        }
        try {
          const mod = await import(apiPricesModuleUrl)
          await mod.sendPricesHttpResponse(req, res)
        } catch (e) {
          console.error('[vite] /api/prices handler failed:', e)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(e?.message || String(e))
          }
        }
      }

      const stack = server.middlewares.stack
      if (Array.isArray(stack)) {
        stack.unshift({
          route: '',
          handle: handler,
        })
      } else {
        server.middlewares.use(handler)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [pricesApiDevPlugin(), tailwindcss(), react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
