import { randomBytes } from 'node:crypto'
import { pool } from '../db.js'

export async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM integration_settings WHERE key = $1', [key])
  return rows[0]?.value ?? ''
}

export async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO integration_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  )
}

export async function webhookToken() {
  const existing = await getSetting('indiamart_webhook_token')
  if (existing) return existing
  const token = randomBytes(18).toString('hex')
  await setSetting('indiamart_webhook_token', token)
  return token
}

export function httpError(status, message, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}
