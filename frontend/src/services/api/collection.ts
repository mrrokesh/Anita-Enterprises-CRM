import type { CreateInput, Entity, UpdateInput } from '@/types'
import { ensureReady } from './ready'
import { request } from './http'
import type { ListParams, Paginated } from './types'

interface Options {
  name: string
}

/**
 * REST client for one resource.
 * GET /:name, GET /:name/:id, POST /:name, PATCH /:name/:id, DELETE /:name/:id.
 */
export function createCollectionApi<T extends Entity>({ name }: Options) {
  return {
    async list(params: ListParams = {}): Promise<Paginated<T>> {
      await ensureReady()
      const query = new URLSearchParams()
      if (params.search) query.set('search', params.search)
      if (params.filters) query.set('filters', JSON.stringify(params.filters))
      if (params.sortBy) query.set('sortBy', params.sortBy)
      if (params.sortDir) query.set('sortDir', params.sortDir)
      if (params.page) query.set('page', String(params.page))
      if (params.pageSize) query.set('pageSize', String(params.pageSize))
      const qs = query.toString()
      return request<Paginated<T>>(`/${name}${qs ? `?${qs}` : ''}`)
    },

    async get(id: string): Promise<T> {
      await ensureReady()
      return request<T>(`/${name}/${encodeURIComponent(id)}`)
    },

    async create(input: CreateInput<T>): Promise<T> {
      await ensureReady()
      return request<T>(`/${name}`, { method: 'POST', body: JSON.stringify(input) })
    },

    async update(id: string, patch: UpdateInput<T>): Promise<T> {
      await ensureReady()
      return request<T>(`/${name}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    },

    async remove(id: string): Promise<void> {
      await ensureReady()
      await request<void>(`/${name}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  }
}
