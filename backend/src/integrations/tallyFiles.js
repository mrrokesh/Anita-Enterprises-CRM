import { createRequire } from 'node:module'
import { decode, tag } from './tally.js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

function blockName(block) {
  const quoted = /NAME="([^"]+)"/i.exec(block)
  return decode((quoted?.[1] || tag(block, 'NAME') || '').trim())
}

export function parseQty(raw) {
  const match = String(raw ?? '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/)
  return match ? Math.abs(Number(match[0])) : null
}

export function parseMoney(raw) {
  const match = String(raw ?? '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/)
  return match ? Math.abs(Number(match[0])) : 0
}

export function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString()
  }
  const raw = String(value ?? '').trim()
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function inventoryItems(block) {
  return block
    .split(/<ALLINVENTORYENTRIES\.LIST\b/i)
    .slice(1)
    .map((entry) => {
      const name = tag(entry, 'STOCKITEMNAME')
      if (!name) return null
      const qty = parseQty(tag(entry, 'BILLEDQTY') || tag(entry, 'ACTUALQTY')) ?? 1
      const amount = parseMoney(tag(entry, 'AMOUNT'))
      const rate = parseMoney(tag(entry, 'RATE')) || (qty ? amount / qty : amount)
      return { name, qty, unitPrice: Math.round(rate * 100) / 100 }
    })
    .filter(Boolean)
}

/** Tally XML export: stock items, sundry debtors, and sales vouchers. */
export function parseTallyXml(xml) {
  const stock = []
  const customers = []
  const sales = []
  for (const block of String(xml).split(/<STOCKITEM\b/i).slice(1)) {
    const name = blockName(block)
    const qty = parseQty(tag(block, 'CLOSINGBALANCE'))
    if (!name || qty == null) continue
    stock.push({ name, qty, rate: parseMoney(tag(block, 'CLOSINGRATE')) })
  }
  for (const block of String(xml).split(/<LEDGER\b/i).slice(1)) {
    const name = blockName(block)
    const parent = tag(block, 'PARENT')
    if (!name || (parent && !/sundry debtors/i.test(parent))) continue
    customers.push({
      name,
      phone: tag(block, 'LEDGERMOBILE') || tag(block, 'LEDGERPHONE'),
      email: tag(block, 'EMAIL'),
      city: tag(block, 'STATENAME') || tag(block, 'LEDSTATENAME'),
    })
  }
  for (const block of String(xml).split(/<VOUCHER\b/i).slice(1)) {
    const type = /VCHTYPE="([^"]+)"/i.exec(block)?.[1] || tag(block, 'VOUCHERTYPENAME')
    if (type && !/sales/i.test(type)) continue
    const party = tag(block, 'PARTYLEDGERNAME') || tag(block, 'PARTYNAME')
    if (!party) continue
    const items = inventoryItems(block)
    const total = parseMoney(tag(block, 'AMOUNT')) || items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)
    sales.push({
      party,
      invoiceNo: tag(block, 'VOUCHERNUMBER') || tag(block, 'REFERENCE') || '',
      date: asDate(tag(block, 'DATE')),
      items: items.length ? items : [{ name: party, qty: 1, unitPrice: total }],
      total,
    })
  }
  return { stock, customers, sales }
}

const HEADER = (value) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')

function cell(row, keys) {
  for (const [key, value] of Object.entries(row)) {
    if (keys.includes(HEADER(key))) return value
  }
  return ''
}

const NAME_KEYS = ['name', 'item', 'itemname', 'stockitem', 'particulars', 'product']
const QTY_KEYS = ['qty', 'quantity', 'closing', 'closingbalance', 'closingqty', 'balance']
const RATE_KEYS = ['rate', 'price', 'mrp', 'sellingprice', 'closingrate']
const PARTY_KEYS = ['party', 'customer', 'ledger', 'partyname', 'partyledgername']
const INVOICE_KEYS = ['invoiceno', 'voucherno', 'vchno', 'billno', 'vouchernumber']
const DATE_KEYS = ['date', 'voucherdate', 'billdate']
const AMOUNT_KEYS = ['amount', 'total', 'value', 'invoiceamount']

function fromRows(rows) {
  const stock = []
  const sales = []
  for (const row of rows) {
    const party = String(cell(row, PARTY_KEYS) ?? '').trim()
    const name = String(cell(row, NAME_KEYS) ?? '').trim()
    const qty = parseQty(cell(row, QTY_KEYS))
    const invoiceNo = String(cell(row, INVOICE_KEYS) ?? '').trim()
    const amount = parseMoney(cell(row, AMOUNT_KEYS))
    const rate = parseMoney(cell(row, RATE_KEYS))
    if (party || invoiceNo) {
      sales.push({
        party: party || name,
        invoiceNo,
        date: asDate(cell(row, DATE_KEYS)),
        items: [{ name: name || party, qty: qty ?? 1, unitPrice: rate || amount }],
        total: amount || (rate || amount) * (qty ?? 1),
      })
      continue
    }
    if (name && qty != null) stock.push({ name, qty, rate })
  }
  return { stock, customers: [], sales }
}

export function parseWorkbook(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const stock = []
  const sales = []
  const customers = []
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { defval: '', raw: true })
    const parsed = fromRows(rows)
    stock.push(...parsed.stock)
    sales.push(...parsed.sales)
  }
  return { stock, customers, sales }
}

export function parseTallyFile(filename, base64) {
  const buffer = Buffer.from(base64, 'base64')
  const lower = String(filename ?? '').toLowerCase()
  if (lower.endsWith('.xml') || buffer.subarray(0, 80).toString('utf8').includes('<')) {
    const text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString('utf16le') : buffer.toString('utf8')
    return parseTallyXml(text.replace(/^\uFEFF/, ''))
  }
  return parseWorkbook(buffer)
}
