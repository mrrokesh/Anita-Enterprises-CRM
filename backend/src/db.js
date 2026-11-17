import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') })

const { Pool } = pg

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is missing. Copy backend/.env.example to backend/.env.')
}

export const pool = new Pool({ connectionString })

export async function initDb() {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(schema)
}
