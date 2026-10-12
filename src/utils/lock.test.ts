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
    linkSync: jest.fn(),
    utimesSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
  rmSync: jest.fn(),
  renameSync: jest.fn(),
  linkSync: jest.fn(),
  utimesSync: jest.fn(),
}))

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_HOME_DIR: '/home/test/.betty',
}))

import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { withLock, withLockAsync } from './lock'
import { BettyError } from './errors'

// Match the platform-specific separators that path.join uses in lock.ts.
const LOCK_PATH = path.join('/home/test/.betty', '.lock')
const OTHER_PID = 424242
// PID, host and start time, which differs by a few milliseconds between reads.
const OWN_LOCK = expect.stringMatching(new RegExp(`^${String(process.pid)}\n${os.hostname()}\n\\d+$`))

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
    expect(fs.writeFileSync).toHaveBeenCalledWith(LOCK_PATH, OWN_LOCK, { flag: 'wx' })
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
    expect(fs.writeFileSync).toHaveBeenLastCalledWith(LOCK_PATH, OWN_LOCK, { flag: 'wx' })
  })

  it('stamps a new lock with this machine\'s clock, not a file server\'s', () => {
    withLock(() => undefined)

    expect(fs.utimesSync).toHaveBeenCalledWith(LOCK_PATH, expect.any(Date), expect.any(Date))
  })

  it('reclaims a lock whose PID now belongs to a process started at another time', () => {
    const startedAt = Date.now() - 10 * 60_000
    lockHeldBy(`${String(OTHER_PID)}\n${os.hostname()}\n${String(startedAt)}`)
    processRunning(true)
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(Buffer.from(new Date(startedAt + 3 * 60_000).toISOString()))

    const result = withLock(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(String(process.pid))
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(execFileSync).toHaveBeenCalledWith(process.platform === 'win32' ? 'powershell' : 'ps', expect.arrayContaining([expect.stringContaining(String(OTHER_PID))]), expect.anything())
  })

  it('keeps a lock whose owner started when the lock says, give or take a second', () => {
    const startedAt = Date.now() - 10 * 60_000
    lockHeldBy(`${String(OTHER_PID)}\n${os.hostname()}\n${String(startedAt)}`)
    processRunning(true)
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(Buffer.from(`${new Date(startedAt - 800).toISOString()}\n`))

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
  })

  it('keeps a lock whose owner\'s start time cannot be read', () => {
    lockHeldBy(`${String(OTHER_PID)}\n${os.hostname()}\n${String(Date.now() - 60_000)}`)
    processRunning(true)
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('ps: not found') })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
  })

  it('reclaims a lock older than an hour even if its PID is alive, since the PID may have been reused', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(true)
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() - 2 * 60 * 60_000 })

    expect(withLock(() => 'ok')).toBe('ok')
    expect(fs.writeFileSync).toHaveBeenLastCalledWith(LOCK_PATH, OWN_LOCK, { flag: 'wx' })
  })

  it('puts back a fresh lock that another process took between the check and the reclaim', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(false)
    // The file moved away now belongs to a third process that reclaimed it first.
    ;(fs.renameSync as unknown as jest.Mock).mockImplementationOnce(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('515151')
    })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
    // Put back with linkSync, which cannot replace a lock created meanwhile.
    expect(fs.linkSync).toHaveBeenCalledWith(expect.stringContaining('.stale'), LOCK_PATH)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('puts back a fresh lock that is still empty while its owner writes it', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(false)
    ;(fs.renameSync as unknown as jest.Mock).mockImplementationOnce(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
    expect(fs.linkSync).toHaveBeenCalledWith(expect.stringContaining('.stale'), LOCK_PATH)
  })

  it('puts a lock back without hard links, e.g. on FAT or network shares', () => {
    lockHeldBy(String(OTHER_PID))
    processRunning(false)
    ;(fs.renameSync as unknown as jest.Mock).mockImplementationOnce(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('515151')
    })
    ;(fs.linkSync as unknown as jest.Mock).mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) })

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
    expect(fs.writeFileSync).toHaveBeenLastCalledWith(LOCK_PATH, '515151', { flag: 'wx' })
  })

  it('does not judge a lock from another machine by its PID', () => {
    lockHeldBy(`${String(OTHER_PID)}\nother-host`)
    processRunning(false)

    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
    expect(fs.renameSync).not.toHaveBeenCalled()
  })

  it('reclaims a lock from another machine once it is older than an hour', () => {
    lockHeldBy(`${String(OTHER_PID)}\nother-host`)
    processRunning(true)
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() - 2 * 60 * 60_000 })

    const result = withLock(() => {
      ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(OWN_LOCK)
      return 'ok'
    })

    expect(result).toBe('ok')
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
    expect(fs.writeFileSync).toHaveBeenCalledWith(LOCK_PATH, OWN_LOCK, { flag: 'wx' })
    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('releases the lock even when the promise rejects', async () => {
    await expect(withLockAsync(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('keeps the lock young while fn waits, e.g. at a prompt left open', async () => {
    jest.useFakeTimers()
    try {
      let finish: () => void = () => undefined
      const running = withLockAsync(() => new Promise<void>((resolve) => { finish = resolve }))
      // Once when the lock is taken, then every five minutes.
      jest.advanceTimersByTime(11 * 60_000)
      expect(fs.utimesSync).toHaveBeenCalledTimes(3)
      finish()
      await running
      jest.advanceTimersByTime(10 * 60_000)
      expect(fs.utimesSync).toHaveBeenCalledTimes(3)
    } finally {
      jest.useRealTimers()
    }
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
