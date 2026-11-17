import { createHash } from 'node:crypto'
import { pool } from '../db.js'
import { listDocs, updateDoc } from '../resources.js'
import { nationalPhone } from './indiamart.js'

function fold(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function matchProduct(name, products) {
  const q = fold(name)
  if (q.length < 3) return null
  return (
    products.find((product) => fold(product.name) === q) ??
    products.find((product) => {
      const n = fold(product.name)
      return n.length >= 4 && (q.includes(n) || n.includes(q))
    }) ??
    null
  )
}

function stockStatus(qty) {
  if (qty <= 0) return 'out_of_stock'
  if (qty <= 3) return 'low'
  return 'in_stock'
}

function customerId(name, phone) {
  if (phone) return `c_${phone}`
  return `c_tally_${createHash('sha1').update(fold(name)).digest('hex').slice(0, 10)}`
}

async function insertCustomer(doc) {
  const { rowCount } = await pool.query(
    `INSERT INTO customers (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [doc.id, JSON.stringify(doc), doc.createdAt, doc.updatedAt],
  )
  return rowCount > 0
}

async function ensureCustomer(list, input) {
  const phone = nationalPhone(input.phone)
  const name = String(input.name || 'Tally customer').slice(0, 160)
  const found = list.find(
    (row) => (phone && row.phone === phone) || fold(row.name) === fold(name) || fold(row.businessName) === fold(name),
  )
  const now = new Date().toISOString()
  if (found) {
    found.businessName = found.businessName || name
    found.email = found.email || input.email || ''
    found.city = found.city || input.city || ''
    found.tags = [...new Set([...(found.tags ?? []), 'tally'])]
    found.updatedAt = now
    await updateDoc('customers', found.id, {
      businessName: found.businessName,
      email: found.email,
      city: found.city,
      tags: found.tags,
    })
    return { doc: found, created: false }
  }
  const doc = {
    id: customerId(name, phone),
    leadId: null,
    name,
    businessName: name,
    phone,
    email: input.email || '',
    city: input.city || '',
    tags: ['tally'],
    purchases: [],
    totalSpent: 0,
    createdAt: now,
    updatedAt: now,
  }
  const created = await insertCustomer(doc)
  if (created) list.push(doc)
  else {
    const again = (await listDocs('customers')).find((row) => row.id === doc.id)
    if (again) list.push(again)
    return { doc: again ?? doc, created: false }
  }
  return { doc, created: true }
}

/**
 * Writes Tally stock onto matching catalog items, and sales onto customer history.
 * Invoice numbers already stored are skipped, so a daily file can be loaded again.
 */
export async function applyBooks({ stock = [], sales = [], customers = [] }) {
  const products = await listDocs('products')
  const people = await listDocs('customers')
  let stockUpdated = 0
  const unmatched = []
  for (const row of stock) {
    const product = matchProduct(row.name, products)
    if (!product) {
      if (unmatched.length < 8) unmatched.push(row.name)
      continue
    }
    const qty = Math.max(0, Math.round(row.qty))
    const status = stockStatus(qty)
    await updateDoc('products', product.id, {
      stockQty: qty,
      stockStatus: status,
      restockEta: status === 'out_of_stock' ? product.restockEta : null,
      tallyItemName: row.name,
    })
    product.stockQty = qty
    product.tallyItemName = row.name
    stockUpdated += 1
  }

  let createdCustomers = 0
  for (const row of customers) {
    const result = await ensureCustomer(people, row)
    if (result.created) createdCustomers += 1
  }

  let invoices = 0
  for (const sale of sales) {
    if (!sale.party) continue
    const result = await ensureCustomer(people, { name: sale.party, phone: sale.phone })
    if (result.created) createdCustomers += 1
    const customer = result.doc
    const invoiceNo =
      sale.invoiceNo ||
      `TLY-${createHash('sha1').update(`${sale.party}|${sale.date}|${sale.total}`).digest('hex').slice(0, 8)}`
    if ((customer.purchases ?? []).some((purchase) => purchase.invoiceNo === invoiceNo)) continue
    const items = (sale.items?.length ? sale.items : [{ name: sale.party, qty: 1, unitPrice: sale.total }]).map(
      (item) => {
        const product = matchProduct(item.name, products)
        return {
          productId: product?.id ?? '',
          name: item.name,
          qty: item.qty || 1,
          unitPrice: item.unitPrice || 0,
        }
      },
    )
    const total = sale.total || items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)
    const purchases = [
      ...(customer.purchases ?? []),
      {
        id: `pu_${createHash('sha1').update(invoiceNo).digest('hex').slice(0, 10)}`,
        invoiceNo,
        date: sale.date,
        items,
        total,
      },
    ]
    customer.purchases = purchases
    customer.totalSpent = purchases.reduce((sum, purchase) => sum + (purchase.total || 0), 0)
    await updateDoc('customers', customer.id, {
      purchases,
      totalSpent: customer.totalSpent,
      tags: [...new Set([...(customer.tags ?? []), 'tally'])],
    })
    invoices += 1
  }

  return { stockUpdated, unmatched, customers: createdCustomers, invoices }
}
