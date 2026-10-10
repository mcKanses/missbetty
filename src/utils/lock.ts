import fs from 'fs'
import os from 'os'
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

// The lock holds the owner's PID and host name. A PID means nothing on another
// machine (a home directory on a network share), so a lock from another host is
// only reclaimed by age.
const writeLockFile = (): void => {
  fs.writeFileSync(LOCK_PATH, `${String(process.pid)}\n${os.hostname()}`, { flag: 'wx' })
}

interface LockOwner { pid: number; host: string | null }

const parseOwner = (content: string): LockOwner | null => {
  const lines = content.split('\n')
  const pid = parseInt(lines[0], 10)
  if (!Number.isInteger(pid) || pid <= 0) return null
  // Locks of older betty versions carry only the PID.
  const host = lines.length > 1 ? lines[1].trim() : ''
  return { pid, host: host === '' ? null : host }
}

const readOwnerOf = (filePath: string): LockOwner | null => {
  try {
    return parseOwner(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

const readOwner = (): number | null => readOwnerOf(LOCK_PATH)?.pid ?? null

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

const isStale = (owner: LockOwner | null): boolean => {
  const age = lockAge(LOCK_PATH)
  if (owner === null) return age >= UNREADABLE_STALE_MS
  if (age >= MAX_LOCK_AGE_MS) return true
  if (owner.host !== null && owner.host !== os.hostname()) return false
  return !isRunning(owner.pid)
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

  const owner = readOwnerOf(LOCK_PATH)
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
  // the rename; that one goes back. linkSync, unlike renameSync, fails instead
  // of replacing a lock a third process created in the meantime.
  const movedOwner = readOwnerOf(claimed)
  if (movedOwner !== null && movedOwner.pid !== owner?.pid) {
    try { fs.linkSync(claimed, LOCK_PATH) } catch { /* a newer lock is in place */ }
    fs.rmSync(claimed, { force: true })
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
