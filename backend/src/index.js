import cors from 'cors'
import express from 'express'
import { initDb, pool } from './db.js'
import { answerCrm } from './ai.js'
import { registerIntegrations } from './integrations/routes.js'
import { startTallySchedule } from './integrations/schedule.js'
import {
  deleteDoc,
  getDoc,
  insertDoc,
  isResource,
  isSeeded,
  listDocs,
  paginate,
  replaceAll,
  RESOURCES,
  updateDoc,
} from './resources.js'

const app = express()
const port = Number(process.env.PORT) || 8000

app.use(cors())
app.use(express.json({ limit: '8mb', type: ['application/json', 'text/json', 'text/plain'] }))

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
registerIntegrations(app, wrap)

app.post(
  '/api/ai/chat',
  wrap(async (req, res) => {
    res.json(await answerCrm(req.body ?? {}))
  }),
)

function parseListQuery(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(2000, Math.max(1, Number(query.pageSize) || 50))
  const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc'
  let filters = {}
  if (typeof query.filters === 'string' && query.filters) {
    let parsed
    try {
      parsed = JSON.parse(query.filters)
    } catch {
      const error = new Error('filters must be JSON')
      error.status = 400
      throw error
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('filters must be an object')
      error.status = 400
      throw error
    }
    filters = parsed
  }
  return {
    search: typeof query.search === 'string' ? query.search : undefined,
    sortBy: typeof query.sortBy === 'string' ? query.sortBy : undefined,
    sortDir,
    page,
    pageSize,
    filters,
  }
}

app.get(
  '/api/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1')
    res.json({ ok: true })
  }),
)

app.get(
  '/api/admin/status',
  wrap(async (_req, res) => {
    res.json({ seeded: await isSeeded() })
  }),
)

app.post(
  '/api/admin/seed',
  wrap(async (req, res) => {
    await replaceAll(req.body ?? {})
    res.json({ ok: true })
  }),
)

app.get(
  '/api/:resource',
  wrap(async (req, res) => {
    const { resource } = req.params
    if (!isResource(resource)) {
      res.status(404).json({ message: `Unknown resource ${resource}` })
      return
    }
    const params = parseListQuery(req.query)
    const docs = await listDocs(resource)
    res.json(paginate(docs, { ...params, searchFields: RESOURCES[resource].searchFields }))
  }),
)

app.get(
  '/api/:resource/:id',
  wrap(async (req, res) => {
    const { resource, id } = req.params
    if (!isResource(resource)) {
      res.status(404).json({ message: `Unknown resource ${resource}` })
      return
    }
    const doc = await getDoc(resource, id)
    if (!doc) {
      res.status(404).json({ message: `${resource} ${id} not found` })
      return
    }
    res.json(doc)
  }),
)

app.post(
  '/api/:resource',
  wrap(async (req, res) => {
    const { resource } = req.params
    if (!isResource(resource)) {
      res.status(404).json({ message: `Unknown resource ${resource}` })
      return
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ message: 'Body must be an object' })
      return
    }
    const doc = await insertDoc(resource, req.body)
    res.status(201).json(doc)
  }),
)

app.patch(
  '/api/:resource/:id',
  wrap(async (req, res) => {
    const { resource, id } = req.params
    if (!isResource(resource)) {
      res.status(404).json({ message: `Unknown resource ${resource}` })
      return
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ message: 'Body must be an object' })
      return
    }
    const doc = await updateDoc(resource, id, req.body)
    if (!doc) {
      res.status(404).json({ message: `${resource} ${id} not found` })
      return
    }
    res.json(doc)
  }),
)

app.delete(
  '/api/:resource/:id',
  wrap(async (req, res) => {
    const { resource, id } = req.params
    if (!isResource(resource)) {
      res.status(404).json({ message: `Unknown resource ${resource}` })
      return
    }
    const removed = await deleteDoc(resource, id)
    if (!removed) {
      res.status(404).json({ message: `${resource} ${id} not found` })
      return
    }
    res.status(204).end()
  }),
)

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ message: 'Invalid JSON' })
    return
  }
  const status = error.status ?? 500
  if (status >= 500) console.error(error)
  res.status(status).json({ message: error.message || 'Server error' })
})

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`)
      startTallySchedule()
    })
  })
  .catch((error) => {
    console.error('Database setup failed. Is PostgreSQL running?')
    console.error(error.message)
    pool.end()
    process.exit(1)
  })
