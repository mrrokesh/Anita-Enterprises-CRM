import { buildSeed } from '@/data/seed'
import { request } from './http'

let ready: Promise<void> | null = null

async function postSeed() {
  await request('/admin/seed', {
    method: 'POST',
    body: JSON.stringify(buildSeed()),
  })
}

/** Loads demo records into PostgreSQL the first time the API database is empty. */
export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const status = await request<{ seeded: boolean }>('/admin/status')
      if (!status.seeded) await postSeed()
    })().catch((error) => {
      ready = null
      throw error
    })
  }
  return ready
}

/** Replaces PostgreSQL data with a fresh demo seed. */
export async function reseed(): Promise<void> {
  await postSeed()
  ready = Promise.resolve()
}
