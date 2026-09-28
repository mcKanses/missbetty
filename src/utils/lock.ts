import fs from 'fs'
import path from 'path'
import { BETTY_HOME_DIR } from './constants'
import { BettyError } from './errors'

// A best-effort exclusive lock over Betty's shared ~/.betty state, so two
// concurrent betty processes don't corrupt the routing files or hosts entries.
// The lock is a single file created with O_EXCL that holds the owner's PID. A
// lock whose owner is no longer running (a crash, or Ctrl+C at a prompt) is
// reclaimed right away; a live owner keeps it however long it takes.
const LOCK_PATH = path.join(BETTY_HOME_DIR, '.lock')
// Only for a lock file without a readable PID (e.g. caught mid-write).
const UNREADABLE_STALE_MS = 60_000

const busyError = (): BettyError => new BettyError('Another betty command is already running. Please retry in a moment.')

const writeLockFile = (): void => {
  fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
}

const readOwner = (): number | null => {
  try {
    const pid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const isFresh = (): boolean => {
  try {
    return Date.now() - fs.statSync(LOCK_PATH).mtimeMs < UNREADABLE_STALE_MS
  } catch {
    return false
  }
}

const acquire = (): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })

  try {
    writeLockFile()
    return
  } catch (err) {
    // Only an existing lock means another command may be running; any other
    // failure (permissions, a missing directory) is reported as what it is.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw new BettyError(`Could not create the lock file ${LOCK_PATH}: ${err instanceof Error ? err.message : String(err)}`)
    // Lock already exists — reclaim it only if its owner is gone.
  }

  const owner = readOwner()
  if (owner !== null ? isRunning(owner) : isFresh()) throw busyError()

  fs.rmSync(LOCK_PATH, { force: true })
  try {
    writeLockFile()
  } catch {
    // Another process reclaimed it between our remove and create.
    throw busyError()
  }
}

// Removes the lock only if this process still owns it, so a lock another
// process has taken over is never deleted from under it.
const release = (): void => {
  try {
    if (readOwner() === process.pid) fs.rmSync(LOCK_PATH, { force: true })
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

// Async variant: holds the lock until the returned promise settles, so the
// lock is not released while async work is still in flight.
export const withLockAsync = async <T>(fn: () => Promise<T>): Promise<T> => {
  acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
