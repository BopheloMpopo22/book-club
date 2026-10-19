import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Uint8Array[] = []
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Uint8Array | string) => {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
    })
    req.on('end', () => {
      const method = req.method ?? 'GET'
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value)
        else if (Array.isArray(value)) headers.set(key, value.join(', '))
      }
      const hasBody = method !== 'GET' && method !== 'HEAD'
      resolve(
        new Request(`http://localhost${req.url ?? '/'}`, {
          method,
          headers,
          body: hasBody ? concat(chunks) : undefined,
        }),
      )
    })
    req.on('error', reject)
  })
}

function booksApi(): Plugin {
  return {
    name: 'books-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
        if (!req.url?.startsWith('/api/recommend')) {
          next()
          return
        }
        try {
          const mod = (await server.ssrLoadModule('/src/server/recommend.ts')) as {
            handleRecommend: (request: Request) => Promise<Response>
          }
          const response = await mod.handleRecommend(await toWebRequest(req))
          res.statusCode = response.status
          response.headers.forEach((value, key) => {
            res.setHeader(key, value)
          })
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [react(), booksApi()],
    server: {
      port: 5173,
    },
  }
})
