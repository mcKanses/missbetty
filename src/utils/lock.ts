import fs from 'fs'
import path from 'path'
import { BETTY_HOME_DIR } from './constants'
import { BettyError } from './errors'

// A best-effort exclusive lock over Betty's shared ~/.betty state, so two
// concurrent betty processes don't corrupt the routing files or hosts entries.
// The lock is a single file created with O_EXCL; a lock older than STALE_MS is
// treated as abandoned (e.g. a crashed process) and reclaimed.
const LOCK_PATH = path.join(BETTY_HOME_DIR, '.lock')
const STALE_MS = 60_000

const writeLockFile = (): void => {
  fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
}

const acquire = (): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })

  try {
    writeLockFile()
    return
  } catch {
    // Lock already exists — reclaim it only if it is stale.
  }

  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(LOCK_PATH).mtimeMs
  } catch {
    // Lock vanished between the failed create and the stat; fall through to retry.
  }

  if (mtimeMs !== 0 && Date.now() - mtimeMs < STALE_MS) throw new BettyError('Another betty command is already running. Please retry in a moment.')

  fs.rmSync(LOCK_PATH, { force: true })
  writeLockFile()
}

const release = (): void => {
  try {
    fs.rmSync(LOCK_PATH, { force: true })
  } catch {
    // Best effort: a missing lock file is fine.
  }
}

// Runs fn while holding the lock, releasing it afterwards even if fn throws.
export const withLock = <T>(fn: () => T): T => {
  acquire()
  try {
    return fn()
  } finally {
    release()
  }
}
