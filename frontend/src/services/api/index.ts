/**
 * CRM API. UI code imports ONLY from here (via feature hooks).
 * Records are stored in PostgreSQL by the Express server in /backend.
 */
import type { Customer, Lead, Product, User } from '@/types'
import { createCollectionApi } from './collection'
import { reseed } from './ready'

export const leadsApi = createCollectionApi<Lead>({ name: 'leads' })

export const productsApi = createCollectionApi<Product>({ name: 'products' })

export const customersApi = createCollectionApi<Customer>({ name: 'customers' })

export const usersApi = createCollectionApi<User>({ name: 'users' })

export const adminApi = {
  /** Replaces PostgreSQL CRM data with a fresh demo seed. */
  async resetDemoData(): Promise<void> {
    await reseed()
  },
}

export { integrationsApi } from './integrations'
export type { IndiaMartPull, IntegrationStatus, TallyImportResult, TallyInvoiceResult, TallyMode } from './integrations'
export { ApiError } from './types'
export type { ListParams, Paginated } from './types'
