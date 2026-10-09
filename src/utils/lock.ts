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

// A lock older than this is reclaimed even if its PID is alive: the system may
// have reused the PID of a betty process that was killed without cleaning up.
// No betty command holds the lock for this long, prompts included.
const MAX_LOCK_AGE_MS = 60 * 60_000

const busyError = (): BettyError => new BettyError('Another betty command is already running. Please retry in a moment.', {
  hints: [`If no other betty command is running, delete the lock file: ${LOCK_PATH}`],
})

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

const lockAge = (filePath: string): number => {
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs
  } catch {
    return Infinity
  }
}

const isStale = (owner: number | null): boolean => {
  const age = lockAge(LOCK_PATH)
  if (owner === null) return age >= UNREADABLE_STALE_MS
  return !isRunning(owner) || age >= MAX_LOCK_AGE_MS
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
  if (!isStale(owner)) throw busyError()

  // Reclaim by renaming: only one process can move a given lock file away. A
  // plain delete could remove a lock another process has just reclaimed.
  const claimed = `${LOCK_PATH}.${String(process.pid)}.stale`
  try {
    fs.renameSync(LOCK_PATH, claimed)
  } catch {
    // Another process reclaimed it first.
    throw busyError()
  }
  // The file moved could already be a fresh lock taken between the check and
  // the rename; that one goes back.
  let movedOwner: number | null = null
  try {
    movedOwner = parseInt(fs.readFileSync(claimed, 'utf8'), 10)
  } catch { /* unreadable: treated like the stale lock it replaced */ }
  if (movedOwner !== owner && movedOwner !== null && !Number.isNaN(movedOwner)) {
    try { fs.renameSync(claimed, LOCK_PATH) } catch { /* the other process keeps running either way */ }
    throw busyError()
  }
  fs.rmSync(claimed, { force: true })

  try {
    writeLockFile()
  } catch {
    // Another process created a lock between our rename and create.
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
