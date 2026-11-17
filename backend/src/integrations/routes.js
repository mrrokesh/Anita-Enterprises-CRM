import { listDocs } from '../resources.js'
import { applyBooks } from './tallyApply.js'
import { parseTallyFile } from './tallyFiles.js'
import { extractEnquiry, ingestEnquiry, pullIndiaMart } from './indiamart.js'
import { getSetting, httpError, setSetting, webhookToken } from './settings.js'
import { syncFromTally } from './tallySync.js'
import { importDebtors, postNewCustomers, saveTallySettings, sendWonInvoices, tallyConfig, testTally } from './tally.js'

export function registerIntegrations(app, wrap) {
  app.get(
    '/api/integrations/status',
    wrap(async (req, res) => {
      const [token, key, tally] = await Promise.all([
        webhookToken(),
        getSetting('indiamart_crm_key'),
        tallyConfig(),
      ])
      const proto = req.get('x-forwarded-proto') || req.protocol
      res.json({
        indiamartKeySet: Boolean(key),
        webhookUrl: `${proto}://${req.get('host')}/api/integrations/indiamart/push?token=${token}`,
        tallyUrl: tally.url,
        tallyCompany: tally.company,
        tallySalesLedger: tally.salesLedger,
        tallyMode: tally.mode,
        tallySchedule: tally.schedule,
        tallyPushDaily: tally.pushDaily,
        tallyVoucherType: tally.voucherType,
        tallyGstLedger: tally.gstLedger,
        tallyGstRate: tally.gstRate,
        tallyLastSync: tally.lastSync,
        tallyLastError: tally.lastError,
      })
    }),
  )

  app.post(
    '/api/integrations/settings',
    wrap(async (req, res) => {
      const body = req.body ?? {}
      if (typeof body.indiamartCrmKey === 'string' && body.indiamartCrmKey.trim()) {
        await setSetting('indiamart_crm_key', body.indiamartCrmKey.trim())
      }
      await saveTallySettings(body)
      res.json({ ok: true })
    }),
  )

  app.post(
    '/api/integrations/indiamart/pull',
    wrap(async (_req, res) => {
      res.json(await pullIndiaMart())
    }),
  )

  app.post(
    '/api/integrations/indiamart/push',
    wrap(async (req, res) => {
      const token = await getSetting('indiamart_webhook_token')
      if (!token || req.query.token !== token) {
        res.status(401).json({ message: 'Unknown webhook' })
        return
      }
      const row = extractEnquiry(req.body)
      if (!row) {
        res.json({ ok: true, skipped: true })
        return
      }
      const result = await ingestEnquiry(row, await listDocs('products'))
      res.json({ ok: true, ...result })
    }),
  )

  app.post(
    '/api/integrations/tally/test',
    wrap(async (_req, res) => {
      res.json(await testTally())
    }),
  )

  app.post(
    '/api/integrations/tally/customers',
    wrap(async (_req, res) => {
      res.json(await importDebtors())
    }),
  )

  app.post(
    '/api/integrations/tally/invoices',
    wrap(async (_req, res) => {
      res.json(await sendWonInvoices())
    }),
  )

  app.post(
    '/api/integrations/tally/import',
    wrap(async (req, res) => {
      const data = String(req.body?.data ?? '')
      if (!data) throw httpError(400, 'Choose the XML or Excel file exported from Tally.', 'empty')
      const parsed = parseTallyFile(req.body?.filename, data)
      if (!parsed.stock.length && !parsed.sales.length && !parsed.customers.length) {
        throw httpError(
          400,
          'No stock or sales rows found. Export the Stock Summary and the Sales Register as XML or Excel.',
          'empty',
        )
      }
      res.json(await applyBooks(parsed))
    }),
  )

  app.post(
    '/api/integrations/tally/sync',
    wrap(async (_req, res) => {
      res.json(await syncFromTally({ push: false }))
    }),
  )

  app.post(
    '/api/integrations/tally/push',
    wrap(async (_req, res) => {
      const invoices = await sendWonInvoices()
      const people = await postNewCustomers()
      res.json({
        sent: invoices.sent,
        customers: people.customers,
        errors: [...invoices.errors, ...people.errors].slice(0, 8),
      })
    }),
  )
}
