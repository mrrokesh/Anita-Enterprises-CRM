import { pool } from '../db.js'
import { listDocs } from '../resources.js'
import { getSetting, httpError, setSetting } from './settings.js'

const PULL_URL = 'https://mapi.indiamart.com/wservce/crm/crmListing/v2/'
const MIN_GAP_MS = 5 * 60 * 1000

const QUERY_LABEL = {
  W: 'Direct enquiry',
  B: 'Buy lead',
  P: 'PNS call',
  BIZ: 'Catalog view',
  WA: 'WhatsApp enquiry',
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function nationalPhone(value) {
  const raw = digits(value)
  const national = raw.length > 10 ? raw.slice(-10) : raw
  return /^[6-9]\d{9}$/.test(national) ? national : ''
}

function parseWhen(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return new Date().toISOString()
  const stamp = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/)
  if (stamp) {
    const [, dd, mon, yyyy, hh = '00', mm = '00', ss = '00'] = stamp
    const parsed = new Date(`${dd} ${mon} ${yyyy} ${hh}:${mm}:${ss} GMT+0530`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const iso = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+05:30`)
  return Number.isNaN(iso.getTime()) ? new Date().toISOString() : iso.toISOString()
}

function matchProduct(label, products) {
  const q = String(label ?? '').toLowerCase().trim()
  if (q.length < 3) return null
  const compact = q.replace(/[^a-z0-9]/g, '')
  let best = null
  let score = 0
  for (const product of products) {
    const name = String(product.name ?? '').toLowerCase()
    const folded = name.replace(/[^a-z0-9]/g, '')
    let next = 0
    if (folded && compact.includes(folded)) next = folded.length
    else if (compact.length > 4 && folded.includes(compact)) next = compact.length
    else next = q.split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && name.includes(word)).length * 4
    if (next > score) {
      score = next
      best = product
    }
  }
  return score >= 4 ? best : null
}

export function extractEnquiry(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.RESPONSE && !Array.isArray(payload.RESPONSE) && typeof payload.RESPONSE === 'object')
    return payload.RESPONSE
  if (payload.body && typeof payload.body === 'object') return extractEnquiry(payload.body)
  if (typeof payload.body === 'string') {
    try {
      return extractEnquiry(JSON.parse(payload.body))
    } catch {
      return null
    }
  }
  if (payload.UNIQUE_QUERY_ID || payload.SENDER_NAME || payload.SENDER_MOBILE) return payload
  return null
}

function leadFromEnquiry(row, products) {
  const externalId = String(row.UNIQUE_QUERY_ID ?? '').trim()
  if (!externalId) return null
  const phone = nationalPhone(row.SENDER_MOBILE) || nationalPhone(row.SENDER_MOBILE_ALT)
  const product = matchProduct(row.QUERY_PRODUCT_NAME, products)
  const at = parseWhen(row.QUERY_TIME)
  const kind = QUERY_LABEL[row.QUERY_TYPE] ?? 'Enquiry'
  const text = [kind, row.SUBJECT, row.QUERY_MESSAGE, row.SENDER_ADDRESS].filter(Boolean).join('\n')
  const city = [row.SENDER_CITY, row.SENDER_STATE].filter(Boolean).join(', ')
  return {
    id: `im_${externalId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`,
    externalId,
    name: String(row.SENDER_NAME || 'IndiaMART Buyer').slice(0, 120),
    businessName: String(row.SENDER_COMPANY || '').slice(0, 160),
    phone,
    email: String(row.SENDER_EMAIL || '').slice(0, 160),
    city,
    source: 'indiamart',
    productInterest: product ? [product.id] : [],
    quantity: 1,
    budget: null,
    stage: 'new',
    assignedTo: null,
    nextFollowUpAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    firstContactedAt: null,
    lastContactedAt: null,
    lostReason: null,
    activities: [
      {
        id: `a_im_${externalId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`,
        type: 'system',
        at,
        by: 'u_1',
        key: 'act.enquiry.indiamart',
        params: { product: product?.name || row.QUERY_PRODUCT_NAME || '—' },
        text,
      },
    ],
    tags: ['indiamart', row.QUERY_TYPE ? `im:${row.QUERY_TYPE}` : ''].filter(Boolean),
    waitlist: [],
    createdAt: at,
    updatedAt: new Date().toISOString(),
  }
}

async function findExisting(lead) {
  const { rows } = await pool.query(
    `SELECT doc FROM leads
     WHERE id = $1 OR doc->>'externalId' = $2
        OR ($3 <> '' AND doc->>'phone' = $3 AND doc->>'stage' NOT IN ('won', 'lost'))
     LIMIT 1`,
    [lead.id, lead.externalId, lead.phone],
  )
  return rows[0]?.doc ?? null
}

async function writeDoc(table, doc) {
  await pool.query(
    `INSERT INTO ${table} (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)`,
    [doc.id, JSON.stringify(doc), doc.createdAt, doc.updatedAt],
  )
}

async function replaceDoc(table, doc) {
  await pool.query(`UPDATE ${table} SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    doc.id,
    JSON.stringify(doc),
    doc.updatedAt,
  ])
}

async function upsertCustomer(lead) {
  const customers = await listDocs('customers')
  const phone = lead.phone
  const existing = customers.find(
    (row) => (phone && row.phone === phone) || row.leadId === lead.id,
  )
  const now = new Date().toISOString()
  if (existing) {
    const tags = [...new Set([...(existing.tags ?? []), 'indiamart'])]
    const next = {
      ...existing,
      leadId: existing.leadId || lead.id,
      name: existing.name || lead.name,
      businessName: existing.businessName || lead.businessName,
      email: existing.email || lead.email,
      city: existing.city || lead.city,
      tags,
      updatedAt: now,
    }
    await replaceDoc('customers', next)
    return false
  }
  await writeDoc('customers', {
    id: phone ? `c_${phone}` : `c_${lead.id}`,
    leadId: lead.id,
    name: lead.name,
    businessName: lead.businessName,
    phone,
    email: lead.email,
    city: lead.city,
    tags: ['indiamart'],
    purchases: [],
    totalSpent: 0,
    createdAt: lead.createdAt,
    updatedAt: now,
  })
  return true
}

export async function ingestEnquiry(row, products) {
  const lead = leadFromEnquiry(row, products)
  if (!lead) return { created: false, duplicate: false, customer: false, skipped: true }
  const existing = await findExisting(lead)
  if (existing) {
    const known = (existing.activities ?? []).some((item) => item.id === lead.activities[0].id)
    if (!known) {
      const next = {
        ...existing,
        activities: [...(existing.activities ?? []), lead.activities[0]],
        tags: [...new Set([...(existing.tags ?? []), ...lead.tags])],
        updatedAt: new Date().toISOString(),
      }
      await replaceDoc('leads', next)
    }
    const customer = await upsertCustomer({ ...lead, id: existing.id, phone: existing.phone || lead.phone })
    return { created: false, duplicate: true, customer, skipped: false }
  }
  await writeDoc('leads', lead)
  const customer = await upsertCustomer(lead)
  return { created: true, duplicate: false, customer, skipped: false }
}

export async function pullIndiaMart() {
  const key = (await getSetting('indiamart_crm_key')).trim()
  if (!key) throw httpError(400, 'Save the IndiaMART Pull API key first.', 'need_key')
  const last = Date.parse(await getSetting('indiamart_last_pull'))
  if (Number.isFinite(last) && Date.now() - last < MIN_GAP_MS) {
    throw httpError(429, 'IndiaMART allows one fetch every 5 minutes. Try again shortly.', 'rate_limit')
  }

  const end = new Date()
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000)
  // IndiaMART wants DD-Mon-YYYYHH:MM:SS in IST, with no space before the time.
  const stamp = (date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('day')}-${get('month')}-${get('year')}${get('hour')}:${get('minute')}:${get('second')}`
  }

  const url = new URL(PULL_URL)
  url.searchParams.set('glusr_crm_key', key)
  url.searchParams.set('start_time', stamp(start))
  url.searchParams.set('end_time', stamp(end))

  let payload
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    payload = await response.json()
  } catch {
    throw httpError(502, 'IndiaMART did not respond. Check the key and try again.', 'failed')
  }
  await setSetting('indiamart_last_pull', new Date().toISOString())

  const code = Number(payload?.CODE)
  if (code === 204) return { created: 0, duplicates: 0, customers: 0, code: 'no_leads' }
  if (code === 401) throw httpError(401, payload?.MESSAGE || 'IndiaMART rejected the key.', 'bad_key')
  if (code === 429) throw httpError(429, payload?.MESSAGE || 'IndiaMART rate limit.', 'rate_limit')
  if (payload?.STATUS === 'FAILURE') {
    throw httpError(502, payload?.MESSAGE || 'IndiaMART returned an error.', 'failed')
  }

  const products = await listDocs('products')
  const rows = Array.isArray(payload?.RESPONSE) ? payload.RESPONSE : []
  const totals = { created: 0, duplicates: 0, customers: 0, code: 'ok' }
  for (const row of rows) {
    const result = await ingestEnquiry(row, products)
    if (result.created) totals.created += 1
    if (result.duplicate) totals.duplicates += 1
    if (result.customer) totals.customers += 1
  }
  return totals
}
