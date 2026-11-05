import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../index'
import { addTrialPhoto, createTrial, deleteTrial, getTrial, saveTrial, trialAsset, TrialError } from '../services/trials'

/** Public catalogue trial (no account). Editing needs the one-time edit token returned on creation. */
const app = new Hono<Env>()
const ip = (c: Context<Env>) => c.req.header('CF-Connecting-IP') || 'unknown'
const token = (c: Context<Env>) => c.req.header('X-Trial-Token') || undefined
const fail = (c: Context<Env>, error: unknown) => {
  if (error instanceof TrialError) return c.json({ error: error.message, code: error.code }, error.status)
  throw error
}
app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow') })

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await createTrial(c.env.DB, c.env, ip(c), body), 201) } catch (error) { return fail(c, error) }
})
app.get('/:id', async (c) => {
  try { return c.json(await getTrial(c.env.DB, c.req.param('id'))) } catch (error) { return fail(c, error) }
})
app.put('/:id', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await saveTrial(c.env.DB, c.env, ip(c), c.req.param('id'), token(c), body)) } catch (error) { return fail(c, error) }
})
app.post('/:id/photos', async (c) => {
  const form = await c.req.formData().catch(() => null)
  try { return c.json(await addTrialPhoto(c.env.DB, c.env, ip(c), c.req.param('id'), token(c), form?.get('file')), 201) } catch (error) { return fail(c, error) }
})
app.delete('/:id', async (c) => {
  try { return c.json(await deleteTrial(c.env.DB, c.env, c.req.param('id'), token(c))) } catch (error) { return fail(c, error) }
})
app.get('/:id/assets/:file', async (c) => {
  try { return await trialAsset(c.env.DB, c.env.ASSETS, c.req.param('id'), c.req.param('file')) } catch (error) { return fail(c, error) }
})

export default app
