import { afterEach, beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    statSync: jest.fn(),
    rmSync: jest.fn(),
    renameSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
  rmSync: jest.fn(),
  renameSync: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_HOME_DIR: '/home/test/.betty',
}))

import fs from 'fs'
import path from 'path'
import { withLock, withLockAsync } from './lock'
import { BettyError } from './errors'

// Match the platform-specific separators that path.join uses in lock.ts.
const LOCK_PATH = path.join('/home/test/.betty', '.lock')
const OTHER_PID = 424242

// What fs throws for an O_EXCL create when the file already exists.
const eexist = (): Error => Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })

const lockHeldBy = (content: string): void => {
  ;(fs.writeFileSync as unknown as jest.Mock).mockImplementationOnce(() => { throw eexist() })
  ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(content)
}

const processRunning = (running: boolean, code = 'ESRCH'): void => {
  jest.spyOn(process, 'kill').mockImplementation(() => {
    if (running) return true
    throw Object.assign(new Error('kill'), { code })
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
  // A lock written just now, unless a test ages it.
  ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() })
  // By default this process owns whatever lock it reads back.
  ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(String(process.pid))
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('withLock', () => {
  it('acquires the lock with its PID, runs fn and releases the lock', () => {
    const result = withLock(() => 'done')

    expect(result).toBe('done')
    expect(fs.writeFileSync).toHaveBeenCalledWith(LOCK_PATH, String(process.pid), { flag: 'wx' })
    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('creates the betty home directory when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    withLock(() => undefined)

    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test/.betty', { recursive: true })
  })

  it('releases the lock even when fn throws', () => {
    expect(() => withLock(() => { throw new Error('boom') })).toThrow('boom')

    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('refuses to run while the owning process is still running, however old the lock is', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(true)
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() - 600_000 })

    expect(() => withLock(() => 'x')).toThrow(BettyError)
    expect(fs.rmSync).not.toHaveBeenCalled()
  })

  it('treats an owner it may not signal (EPERM) as running', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(false, 'EPERM')

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
  })

  it('reclaims a lock right away when its owner is gone, e.g. after Ctrl+C', () => {
    const fn = jest.fn(() => 'ok')
    lockHeldBy(String(OTHER_PID))
    processRunning(false)

    const result = withLock(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(String(process.pid))
      return fn()
    })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalled()
    expect(fs.writeFileSync).toHaveBeenLastCalledWith(LOCK_PATH, String(process.pid), { flag: 'wx' })
  })

  it('reclaims a lock older than an hour even if its PID is alive, since the PID may have been reused', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(true)
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() - 2 * 60 * 60_000 })

    expect(withLock(() => 'ok')).toBe('ok')
    expect(fs.writeFileSync).toHaveBeenLastCalledWith(LOCK_PATH, String(process.pid), { flag: 'wx' })
  })

  it('puts back a fresh lock that another process took between the check and the reclaim', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(false)
    // The file moved away now belongs to a third process that reclaimed it first.
    ;(fs.renameSync as unknown as jest.Mock).mockImplementationOnce(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('515151')
    })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
    expect(fs.renameSync).toHaveBeenLastCalledWith(expect.stringContaining('.stale'), LOCK_PATH)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('names the lock file in the busy message', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(true)
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() })

    try {
      withLock(() => 'x')
    } catch (err) {
      expect((err as BettyError).hints.join(' ')).toContain(LOCK_PATH)
    }
    expect.assertions(1)
  })

  it('falls back to the file age when the lock has no readable PID', () => {
    lockHeldBy('')
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
  })

  it('reports a busy lock when another process wins the reclaim race', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(false)
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementationOnce(() => { throw eexist() })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
  })

  it('does not delete a lock that another process has taken over', () => {
    withLock(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(String(OTHER_PID))
    })

    expect(fs.rmSync).not.toHaveBeenCalled()
  })
})

describe('withLockAsync', () => {
  it('awaits fn and releases the lock', async () => {
    const result = await withLockAsync(async () => Promise.resolve('done'))

    expect(result).toBe('done')
    expect(fs.writeFileSync).toHaveBeenCalledWith(LOCK_PATH, String(process.pid), { flag: 'wx' })
    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('releases the lock even when the promise rejects', async () => {
    await expect(withLockAsync(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('refuses to run while the owning process is still running', async () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(true)

    await expect(withLockAsync(async () => Promise.resolve('x'))).rejects.toThrow('Another betty command is already running')
  })
})

describe('lock file errors', () => {
  it('reports a failure to create the lock file instead of claiming another command is running', () => {
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })

    expect(() => withLock(() => 'x')).toThrow('Could not create the lock file')
    expect(() => withLock(() => 'x')).not.toThrow('Another betty command is already running')
  })
})
