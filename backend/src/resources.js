import { randomBytes } from 'node:crypto'
import { pool } from './db.js'

/** Search fields match the frontend collection client. */
export const RESOURCES = {
  leads: { searchFields: ['name', 'businessName', 'phone', 'city', 'email'], idPrefix: 'l' },
  products: { searchFields: ['name', 'brand', 'category'], idPrefix: 'p' },
  customers: { searchFields: ['name', 'businessName', 'phone', 'city'], idPrefix: 'c' },
  users: { searchFields: ['name', 'email'], idPrefix: 'u' },
}

const TABLES = Object.keys(RESOURCES)

export function isResource(name) {
  return Object.prototype.hasOwnProperty.call(RESOURCES, name)
}

function generateId(prefix) {
  return `${prefix}_${randomBytes(5).toString('hex')}`
}

function matches(value, wanted) {
  if (Array.isArray(wanted)) return wanted.some((item) => matches(value, item))
  if (Array.isArray(value)) return value.includes(wanted)
  return value === wanted
}

export function paginate(docs, { search, searchFields, filters, sortBy, sortDir = 'asc', page = 1, pageSize = 50 }) {
  let rows = docs
  if (search?.trim()) {
    const q = search.trim().toLowerCase()
    rows = rows.filter((row) =>
      searchFields.some((field) =>
        String(row[field] ?? '')
          .toLowerCase()
          .includes(q),
      ),
    )
  }
  for (const [field, wanted] of Object.entries(filters ?? {})) {
    if (wanted === undefined || wanted === '' || wanted === null) continue
    rows = rows.filter((row) => matches(row[field], wanted))
  }
  if (sortBy) {
    const dir = sortDir === 'desc' ? -1 : 1
    rows = [...rows].sort((a, b) => {
      const x = a[sortBy]
      const y = b[sortBy]
      if (x === y) return 0
      if (x == null) return 1
      if (y == null) return -1
      return x > y ? dir : -dir
    })
  }
  const total = rows.length
  const start = (page - 1) * pageSize
  return { data: rows.slice(start, start + pageSize), total, page, pageSize }
}

export async function listDocs(resource) {
  const { rows } = await pool.query(`SELECT doc FROM ${resource} ORDER BY created_at DESC`)
  return rows.map((row) => row.doc)
}

export async function getDoc(resource, id) {
  const { rows } = await pool.query(`SELECT doc FROM ${resource} WHERE id = $1`, [id])
  return rows[0]?.doc ?? null
}

export async function insertDoc(resource, input) {
  const now = new Date().toISOString()
  const doc = {
    ...input,
    id: generateId(RESOURCES[resource].idPrefix),
    createdAt: now,
    updatedAt: now,
  }
  await pool.query(
    `INSERT INTO ${resource} (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)`,
    [doc.id, JSON.stringify(doc), doc.createdAt, doc.updatedAt],
  )
  return doc
}

export async function updateDoc(resource, id, patch) {
  const current = await getDoc(resource, id)
  if (!current) return null
  const doc = {
    ...current,
    ...patch,
    id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  }
  await pool.query(`UPDATE ${resource} SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    id,
    JSON.stringify(doc),
    doc.updatedAt,
  ])
  return doc
}

export async function deleteDoc(resource, id) {
  const { rowCount } = await pool.query(`DELETE FROM ${resource} WHERE id = $1`, [id])
  return rowCount > 0
}

export async function isSeeded() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users')
  return rows[0].n > 0
}

export async function replaceAll(payload) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`TRUNCATE ${TABLES.join(', ')}`)
    for (const name of TABLES) {
      const items = payload[name]
      if (!Array.isArray(items)) {
        const error = new Error(`${name} must be an array`)
        error.status = 400
        throw error
      }
      for (const doc of items) {
        if (!doc || typeof doc.id !== 'string') {
          const error = new Error(`Each ${name} record needs a string id`)
          error.status = 400
          throw error
        }
        const createdAt = doc.createdAt ?? new Date().toISOString()
        const updatedAt = doc.updatedAt ?? createdAt
        await client.query(
          `INSERT INTO ${name} (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)`,
          [doc.id, JSON.stringify(doc), createdAt, updatedAt],
        )
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
