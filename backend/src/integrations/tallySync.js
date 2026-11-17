import { applyBooks } from './tallyApply.js'
import { parseTallyXml } from './tallyFiles.js'
import { httpError, setSetting } from './settings.js'
import {
  assertUrl,
  companyClause,
  lineError,
  postNewCustomers,
  postXml,
  sendWonInvoices,
  tallyConfig,
  xmlEscape,
} from './tally.js'

function ymd(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}`
}

function exportEnvelope(company, id, tdl, dates) {
  const range = dates
    ? `<SVFROMDATE>${dates.from}</SVFROMDATE><SVTODATE>${dates.to}</SVTODATE>`
    : ''
  return `<ENVELOPE>
    <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${id}</ID></HEADER>
    <BODY><DESC>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${range}${companyClause(company)}</STATICVARIABLES>
      <TDL><TDLMESSAGE>${tdl}</TDLMESSAGE></TDL>
    </DESC></BODY>
  </ENVELOPE>`
}

function debtorTdl() {
  return `<COLLECTION NAME="CrmDebtors" ISMODIFY="No">
    <TYPE>Ledger</TYPE>
    <FILTER>OnlyDebtors</FILTER>
    <FETCH>Name, Parent, LedgerMobile, LedgerPhone, Email, StateName</FETCH>
  </COLLECTION>
  <SYSTEM TYPE="Formulae" NAME="OnlyDebtors">$$IsEqual:$Parent:"Sundry Debtors"</SYSTEM>`
}

function stockTdl() {
  return `<COLLECTION NAME="CrmStock" ISMODIFY="No">
    <TYPE>Stock Item</TYPE>
    <FETCH>Name, BaseUnits, ClosingBalance, ClosingRate</FETCH>
  </COLLECTION>`
}

function salesTdl(voucherType) {
  const type = xmlEscape(voucherType || 'Sales')
  return `<COLLECTION NAME="CrmSales" ISMODIFY="No">
    <TYPE>Voucher</TYPE>
    <FILTER>OnlySales</FILTER>
    <FETCH>Date, VoucherNumber, VoucherTypeName, PartyLedgerName, Amount, AllInventoryEntries</FETCH>
  </COLLECTION>
  <SYSTEM TYPE="Formulae" NAME="OnlySales">$$IsEqual:$VoucherTypeName:"${type}"</SYSTEM>`
}

async function pull(url, xml) {
  try {
    const body = await postXml(url, xml)
    return { xml: body, error: lineError(body) }
  } catch (error) {
    return { xml: '', error: error.message }
  }
}

/** Pulls customers, stock and sales from the open Tally company into the CRM. */
export async function syncFromTally({ push = false } = {}) {
  const cfg = await tallyConfig()
  const url = assertUrl(cfg.url)
  const from = new Date()
  const last = Date.parse(cfg.lastSync)
  from.setDate(from.getDate() - (Number.isFinite(last) ? 2 : 90))
  const dates = { from: ymd(from), to: ymd(new Date()) }

  const debtors = await pull(url, exportEnvelope(cfg.company, 'CrmDebtors', debtorTdl()))
  if (!debtors.xml && debtors.error) throw httpError(502, debtors.error, 'offline')
  const stock = await pull(url, exportEnvelope(cfg.company, 'CrmStock', stockTdl()))
  const sales = await pull(
    url,
    exportEnvelope(cfg.company, 'CrmSales', salesTdl(cfg.voucherType), dates),
  )

  const books = await applyBooks({
    customers: parseTallyXml(debtors.xml).customers,
    stock: parseTallyXml(stock.xml).stock,
    sales: parseTallyXml(sales.xml).sales,
  })

  const errors = [debtors.error, stock.error, sales.error].filter(Boolean)
  let sent = 0
  let postedCustomers = 0
  if (push) {
    const invoices = await sendWonInvoices()
    const people = await postNewCustomers()
    sent = invoices.sent
    postedCustomers = people.customers
    errors.push(...invoices.errors, ...people.errors)
  }

  const now = new Date().toISOString()
  await setSetting('tally_last_sync', now)
  await setSetting('tally_last_error', errors[0] || '')
  return { ...books, sent, postedCustomers, errors: errors.slice(0, 8), lastSync: now }
}
