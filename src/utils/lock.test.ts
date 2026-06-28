import { beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    statSync: jest.fn(),
    rmSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  statSync: jest.fn(),
  rmSync: jest.fn(),
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

beforeEach(() => {
  jest.resetAllMocks()
  ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
})

describe('withLock', () => {
  it('acquires the lock, runs fn and releases the lock', () => {
    const result = withLock(() => 'done')

    expect(result).toBe('done')
    expect(fs.writeFileSync).toHaveBeenCalledWith(LOCK_PATH, expect.any(String), { flag: 'wx' })
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

  it('refuses to run when a fresh lock is already held', () => {
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EEXIST') })
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() })

    expect(() => withLock(() => 'x')).toThrow(BettyError)
    expect(() => withLock(() => 'x')).toThrow('Another betty command is already running')
  })

  it('reclaims a stale lock and runs fn', () => {
    const fn = jest.fn(() => 'ok')
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementationOnce(() => { throw new Error('EEXIST') })
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() - 120_000 })

    expect(withLock(fn)).toBe('ok')
    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
    expect(fn).toHaveBeenCalled()
  })
})

describe('withLockAsync', () => {
  it('awaits fn and releases the lock', async () => {
    const result = await withLockAsync(async () => Promise.resolve('done'))

    expect(result).toBe('done')
    expect(fs.writeFileSync).toHaveBeenCalledWith(LOCK_PATH, expect.any(String), { flag: 'wx' })
    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('releases the lock even when the promise rejects', async () => {
    await expect(withLockAsync(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    expect(fs.rmSync).toHaveBeenCalledWith(LOCK_PATH, { force: true })
  })

  it('refuses to run when a fresh lock is already held', async () => {
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EEXIST') })
    ;(fs.statSync as unknown as jest.Mock).mockReturnValue({ mtimeMs: Date.now() })

    await expect(withLockAsync(async () => Promise.resolve('x'))).rejects.toThrow('Another betty command is already running')
  })
})
