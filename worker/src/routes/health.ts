import { Hono } from 'hono'
import type { Env } from '../index'

const app = new Hono<Env>()

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  })
})

export default app