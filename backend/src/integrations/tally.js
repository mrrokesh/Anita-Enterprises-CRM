import { createHash } from 'node:crypto'
import { pool } from '../db.js'
import { listDocs, updateDoc } from '../resources.js'
import { getSetting, httpError, setSetting } from './settings.js'
import { nationalPhone } from './indiamart.js'

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function decode(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i'))
  return match ? decode(match[1].trim()) : ''
}

export async function tallyConfig() {
  const mode = await getSetting('tally_mode')
  const schedule = await getSetting('tally_schedule')
  return {
    url: (await getSetting('tally_url')) || 'http://127.0.0.1:9000',
    company: await getSetting('tally_company'),
    salesLedger: (await getSetting('tally_sales_ledger')) || 'Sales',
    mode: mode === 'one-way' || mode === 'two-way' ? mode : 'file',
    schedule: schedule === 'daily' ? 'daily' : 'off',
    pushDaily: (await getSetting('tally_push_daily')) === 'yes',
    voucherType: (await getSetting('tally_voucher_type')) || 'Sales',
    gstLedger: await getSetting('tally_gst_ledger'),
    gstRate: Number(await getSetting('tally_gst_rate')) || 0,
    lastSync: await getSetting('tally_last_sync'),
    lastError: await getSetting('tally_last_error'),
  }
}

export function assertUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw httpError(400, 'Tally address must be a URL such as http://127.0.0.1:9000.', 'bad_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpError(400, 'Tally address must start with http:// or https://.', 'bad_url')
  }
  return url.origin
}

export async function postXml(url, body) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw httpError(
      502,
      'Tally is not reachable. Open TallyPrime, load the company, then set F1 → Settings → Connectivity so Tally acts as Server on port 9000.',
      'offline',
    )
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const xml =
    buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.toString('utf16le')
      : buffer.toString('utf8')
  return xml.replace(/^\uFEFF/, '')
}

export function lineError(xml) {
  const match = xml.match(/<LINEERROR>([^<]+)<\/LINEERROR>/i)
  return match ? decode(match[1]) : ''
}

export function companyClause(company) {
  return company ? `<SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>` : ''
}

export async function testTally() {
  const { url, company } = await tallyConfig()
  const xml = await postXml(
    assertUrl(url),
    `<ENVELOPE>
      <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER>
      <BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${companyClause(company)}</STATICVARIABLES></DESC></BODY>
    </ENVELOPE>`,
  )
  if (!/<ENVELOPE/i.test(xml)) throw httpError(502, 'Tally answered in an unexpected format.', 'bad_xml')
  const names = [...xml.matchAll(/<(?:COMPANYNAME|NAME)>([^<]+)<\/(?:COMPANYNAME|NAME)>/gi)].map((m) =>
    decode(m[1].trim()),
  )
  const error = lineError(xml)
  return { ok: !error, company: names.find(Boolean) || company || '', message: error }
}

export async function importDebtors() {
  const { url, company } = await tallyConfig()
  const xml = await postXml(
    assertUrl(url),
    `<ENVELOPE>
      <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CrmDebtors</ID></HEADER>
      <BODY>
        <DESC>
          <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${companyClause(company)}</STATICVARIABLES>
          <TDL><TDLMESSAGE>
            <COLLECTION NAME="CrmDebtors" ISMODIFY="No">
              <TYPE>Ledger</TYPE>
              <FILTER>OnlyDebtors</FILTER>
              <FETCH>Name, Parent, LedgerMobile, LedgerPhone, Email, StateName</FETCH>
            </COLLECTION>
            <SYSTEM TYPE="Formulae" NAME="OnlyDebtors">$$IsEqual:$Parent:"Sundry Debtors"</SYSTEM>
          </TDLMESSAGE></TDL>
        </DESC>
      </BODY>
    </ENVELOPE>`,
  )
  const error = lineError(xml)
  if (error) throw httpError(502, error, 'tally')
  const now = new Date().toISOString()
  const existing = await listDocs('customers')
  let imported = 0
  for (const block of xml.split(/<LEDGER\b/i).slice(1)) {
    const name = (/NAME="([^"]+)"/i.exec(block)?.[1] && decode(/NAME="([^"]+)"/i.exec(block)[1])) || tag(block, 'NAME')
    if (!name) continue
    const parent = tag(block, 'PARENT')
    if (parent && !/sundry debtors/i.test(parent)) continue
    const phone = nationalPhone(tag(block, 'LEDGERMOBILE') || tag(block, 'LEDGERPHONE'))
    const email = tag(block, 'EMAIL')
    const city = tag(block, 'STATENAME')
    const found = existing.find(
      (row) => (phone && row.phone === phone) || row.name.toLowerCase() === name.toLowerCase(),
    )
    if (found) {
      const tags = [...new Set([...(found.tags ?? []), 'tally'])]
      found.tags = tags
      found.businessName = found.businessName || name
      found.email = found.email || email
      found.city = found.city || city
      found.updatedAt = now
      await poolUpdate('customers', found)
      continue
    }
    const doc = {
      id: phone
        ? `c_${phone}`
        : `c_tally_${createHash('sha1').update(name).digest('hex').slice(0, 10)}`,
      leadId: null,
      name,
      businessName: name,
      phone,
      email,
      city,
      tags: ['tally'],
      purchases: [],
      totalSpent: 0,
      createdAt: now,
      updatedAt: now,
    }
    const inserted = await poolInsert('customers', doc)
    if (inserted) {
      existing.push(doc)
      imported += 1
    }
  }
  return { imported }
}

async function poolInsert(table, doc) {
  const { rowCount } = await pool.query(
    `INSERT INTO ${table} (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [doc.id, JSON.stringify(doc), doc.createdAt, doc.updatedAt],
  )
  return rowCount
}

async function poolUpdate(table, doc) {
  await pool.query(`UPDATE ${table} SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    doc.id,
    JSON.stringify(doc),
    doc.updatedAt,
  ])
}

function istDate(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}`
}

function dealAmount(lead, products) {
  if (lead.budget && lead.budget > 0) return Math.round(lead.budget)
  return (lead.productInterest ?? []).reduce((sum, id) => {
    const product = products.find((item) => item.id === id)
    return sum + (product ? product.sellingPrice * (lead.quantity || 1) : 0)
  }, 0)
}

async function ensureLedger(url, company, lead) {
  const name = (lead.businessName || lead.name).slice(0, 80)
  const xml = await postXml(
    url,
    `<ENVELOPE>
      <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
      <BODY><IMPORTDATA>
        <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${companyClause(company)}</STATICVARIABLES></REQUESTDESC>
        <REQUESTDATA><TALLYMESSAGE>
          <LEDGER ACTION="Create">
            <NAME>${xmlEscape(name)}</NAME>
            <PARENT>Sundry Debtors</PARENT>
            <COUNTRYNAME>India</COUNTRYNAME>
            <LEDGERMOBILE>${xmlEscape(lead.phone)}</LEDGERMOBILE>
            <EMAIL>${xmlEscape(lead.email)}</EMAIL>
          </LEDGER>
        </TALLYMESSAGE></REQUESTDATA>
      </IMPORTDATA></BODY>
    </ENVELOPE>`,
  )
  const error = lineError(xml)
  if (error && !/already exists|duplicate/i.test(error)) throw httpError(502, `${name}: ${error}`, 'tally')
  return name
}

function money(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2)
}

/** Prices in the CRM are what the customer pays. GST is taken out of that total. */
function splitTax(total, rate) {
  if (!rate) return { sales: total, gst: 0 }
  const gst = Math.round(((total * rate) / (100 + rate)) * 100) / 100
  return { sales: Math.round((total - gst) * 100) / 100, gst }
}

function voucherXml({ company, party, lead, amount, products, salesLedger, voucherType, gstLedger, gstRate }) {
  const { sales, gst } = splitTax(amount, gstLedger ? gstRate : 0)
  const lines = (lead.productInterest ?? [])
    .map((id) => products.find((item) => item.id === id))
    .filter(Boolean)
  const lineTotal = lines.reduce((sum, product) => sum + product.sellingPrice * (lead.quantity || 1), 0)
  const inventory = (lineTotal > 0 ? lines : [])
    .map((product) => {
      const qty = lead.quantity || 1
      const share = (product.sellingPrice * qty) / lineTotal
      const lineAmount = sales * share
      const name = product.tallyItemName || product.name
      return `<ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME>${xmlEscape(name)}</STOCKITEMNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <BILLEDQTY>${qty} Nos</BILLEDQTY>
        <ACTUALQTY>${qty} Nos</ACTUALQTY>
        <RATE>${money(lineAmount / qty)}/Nos</RATE>
        <AMOUNT>${money(lineAmount)}</AMOUNT>
        <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>${xmlEscape(salesLedger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${money(lineAmount)}</AMOUNT>
        </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>`
    })
    .join('')
  const salesLine = inventory
    ? ''
    : `<LEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEscape(salesLedger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${money(sales)}</AMOUNT>
      </LEDGERENTRIES.LIST>`
  const gstLine =
    gst > 0
      ? `<LEDGERENTRIES.LIST>
          <LEDGERNAME>${xmlEscape(gstLedger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${money(gst)}</AMOUNT>
        </LEDGERENTRIES.LIST>`
      : ''
  return `<ENVELOPE>
    <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
    <BODY><IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${companyClause(company)}</STATICVARIABLES></REQUESTDESC>
      <REQUESTDATA><TALLYMESSAGE>
        <VOUCHER VCHTYPE="${xmlEscape(voucherType)}" ACTION="Create">
          <DATE>${istDate(lead.updatedAt || new Date().toISOString())}</DATE>
          <VOUCHERTYPENAME>${xmlEscape(voucherType)}</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${xmlEscape(party)}</PARTYLEDGERNAME>
          <REFERENCE>${xmlEscape(lead.id)}</REFERENCE>
          <NARRATION>${xmlEscape(`CRM ${lead.name}`)}</NARRATION>
          <PERSISTEDVIEW>${inventory ? 'Invoice Voucher View' : 'Accounting Voucher View'}</PERSISTEDVIEW>
          <ISINVOICE>${inventory ? 'Yes' : 'No'}</ISINVOICE>
          ${inventory}
          <LEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(party)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>-${money(amount)}</AMOUNT>
          </LEDGERENTRIES.LIST>
          ${salesLine}
          ${gstLine}
        </VOUCHER>
      </TALLYMESSAGE></REQUESTDATA>
    </IMPORTDATA></BODY>
  </ENVELOPE>`
}

export async function sendWonInvoices() {
  const cfg = await tallyConfig()
  const origin = assertUrl(cfg.url)
  const products = await listDocs('products')
  const leads = (await listDocs('leads')).filter(
    (lead) => lead.stage === 'won' && !(lead.tags ?? []).includes('tally-sent'),
  )
  const errors = []
  let sent = 0
  for (const lead of leads.slice(0, 25)) {
    const amount = dealAmount(lead, products)
    if (!amount) {
      errors.push(`${lead.name}: no amount to bill`)
      continue
    }
    try {
      const party = await ensureLedger(origin, cfg.company, lead)
      const xml = await postXml(origin, voucherXml({ ...cfg, company: cfg.company, party, lead, amount, products }))
      const error = lineError(xml)
      const created = /<CREATED>\s*[1-9]/i.test(xml) || /<ALTERED>\s*[1-9]/i.test(xml)
      if (error || !created) {
        errors.push(`${lead.name}: ${error || 'Tally rejected the voucher. Check the stock item name, voucher type and GST ledger.'}`)
        continue
      }
      await updateDoc('leads', lead.id, { tags: [...new Set([...(lead.tags ?? []), 'tally-sent'])] })
      sent += 1
    } catch (error) {
      errors.push(`${lead.name}: ${error.message}`)
    }
  }
  return { sent, pending: leads.length, errors }
}

/** IndiaMART buyers who are not already in the Tally company. */
export async function postNewCustomers() {
  const cfg = await tallyConfig()
  const origin = assertUrl(cfg.url)
  const rows = (await listDocs('customers')).filter(
    (row) => (row.tags ?? []).includes('indiamart') && !(row.tags ?? []).includes('tally'),
  )
  const errors = []
  let customers = 0
  for (const row of rows.slice(0, 25)) {
    try {
      await ensureLedger(origin, cfg.company, row)
      await updateDoc('customers', row.id, { tags: [...new Set([...(row.tags ?? []), 'tally'])] })
      customers += 1
    } catch (error) {
      errors.push(`${row.name}: ${error.message}`)
    }
  }
  return { customers, errors }
}

export async function saveTallySettings(body) {
  if (body.tallyUrl !== undefined) await setSetting('tally_url', assertUrl(body.tallyUrl || 'http://127.0.0.1:9000'))
  if (body.tallyCompany !== undefined) await setSetting('tally_company', String(body.tallyCompany).slice(0, 160))
  if (body.tallySalesLedger !== undefined) {
    await setSetting('tally_sales_ledger', String(body.tallySalesLedger || 'Sales').slice(0, 80))
  }
  if (body.tallyMode === 'file' || body.tallyMode === 'one-way' || body.tallyMode === 'two-way') {
    await setSetting('tally_mode', body.tallyMode)
  }
  if (body.tallySchedule === 'daily' || body.tallySchedule === 'off') {
    await setSetting('tally_schedule', body.tallySchedule)
  }
  if (body.tallyPushDaily !== undefined) {
    await setSetting('tally_push_daily', body.tallyPushDaily ? 'yes' : 'no')
  }
  if (body.tallyVoucherType !== undefined) {
    await setSetting('tally_voucher_type', String(body.tallyVoucherType || 'Sales').slice(0, 40))
  }
  if (body.tallyGstLedger !== undefined) {
    await setSetting('tally_gst_ledger', String(body.tallyGstLedger).slice(0, 80))
  }
  if (body.tallyGstRate !== undefined) {
    const rate = Math.min(28, Math.max(0, Number(body.tallyGstRate) || 0))
    await setSetting('tally_gst_rate', String(rate))
  }
}
