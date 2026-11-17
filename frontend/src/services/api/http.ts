import { env } from '@/lib/env'
import { ApiError } from './types'

function baseUrl() {
  return env.apiBaseUrl.replace(/\/$/, '')
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the API. Start PostgreSQL and the backend.')
  }

  if (response.status === 204) return undefined as T

  const body = (await response.json().catch(() => null)) as { message?: string } | null
  if (!response.ok) {
    throw new ApiError(response.status, body?.message || response.statusText || 'Request failed')
  }
  return body as T
}
