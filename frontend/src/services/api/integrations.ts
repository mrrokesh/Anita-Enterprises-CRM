import { request } from './http'

export type TallyMode = 'file' | 'one-way' | 'two-way'

export interface IntegrationStatus {
  indiamartKeySet: boolean
  webhookUrl: string
  tallyUrl: string
  tallyCompany: string
  tallySalesLedger: string
  tallyMode: TallyMode
  tallySchedule: 'daily' | 'off'
  tallyPushDaily: boolean
  tallyVoucherType: string
  tallyGstLedger: string
  tallyGstRate: number
  tallyLastSync: string
  tallyLastError: string
}

export interface TallyImportResult {
  stockUpdated: number
  unmatched: string[]
  customers: number
  invoices: number
  sent?: number
  postedCustomers?: number
  errors?: string[]
  lastSync?: string
}

export interface IndiaMartPull {
  created: number
  duplicates: number
  customers: number
  code: 'ok' | 'no_leads'
}

export interface TallyInvoiceResult {
  sent: number
  pending: number
  errors: string[]
}

export const integrationsApi = {
  status: () => request<IntegrationStatus>('/integrations/status'),
  save: (body: {
    indiamartCrmKey?: string
    tallyUrl?: string
    tallyCompany?: string
    tallySalesLedger?: string
    tallyMode?: TallyMode
    tallySchedule?: 'daily' | 'off'
    tallyPushDaily?: boolean
    tallyVoucherType?: string
    tallyGstLedger?: string
    tallyGstRate?: number
  }) => request<{ ok: true }>('/integrations/settings', { method: 'POST', body: JSON.stringify(body) }),
  pullIndiaMart: () =>
    request<IndiaMartPull>('/integrations/indiamart/pull', { method: 'POST' }),
  testTally: () =>
    request<{ ok: boolean; company: string; message: string }>('/integrations/tally/test', {
      method: 'POST',
    }),
  importTallyCustomers: () =>
    request<{ imported: number }>('/integrations/tally/customers', { method: 'POST' }),
  sendTallyInvoices: () =>
    request<TallyInvoiceResult>('/integrations/tally/invoices', { method: 'POST' }),
  importTallyFile: (filename: string, data: string) =>
    request<TallyImportResult>('/integrations/tally/import', {
      method: 'POST',
      body: JSON.stringify({ filename, data }),
    }),
  syncTally: () => request<TallyImportResult>('/integrations/tally/sync', { method: 'POST' }),
  pushTally: () =>
    request<{ sent: number; customers: number; errors: string[] }>('/integrations/tally/push', {
      method: 'POST',
    }),
}
