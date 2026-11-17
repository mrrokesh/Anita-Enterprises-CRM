import { getSetting, setSetting } from './settings.js'
import { tallyConfig } from './tally.js'
import { syncFromTally } from './tallySync.js'

let running = false

async function tick() {
  if (running) return
  const cfg = await tallyConfig()
  if (cfg.mode === 'file' || cfg.schedule !== 'daily') return
  const last = Date.parse(await getSetting('tally_last_attempt'))
  if (Number.isFinite(last) && Date.now() - last < 20 * 60 * 60 * 1000) return
  running = true
  try {
    await setSetting('tally_last_attempt', new Date().toISOString())
    await syncFromTally({ push: cfg.mode === 'two-way' && cfg.pushDaily })
    console.log('Tally daily sync finished')
  } catch (error) {
    console.error('Tally daily sync failed:', error.message)
    await setSetting('tally_last_error', error.message)
  } finally {
    running = false
  }
}

/** Checks every 15 minutes. A daily sync runs only when the server and Tally are both open. */
export function startTallySchedule() {
  setInterval(() => {
    void tick()
  }, 15 * 60 * 1000)
}
