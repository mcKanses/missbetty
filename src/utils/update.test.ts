import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { isSea } from 'node:sea'
import { BettyError } from './errors'
import { cleanupOldBinary, fetchLatestVersion, installMethod, installUpdate, isNewer } from './update'

jest.mock('child_process', () => ({ execFileSync: jest.fn(), execSync: jest.fn() }))
jest.mock('node:sea', () => ({ isSea: jest.fn(() => false) }))
jest.mock('fs', () => ({
  ...jest.requireActual<object>('fs'),
  mkdtempSync: jest.fn(() => '/tmp/betty-update-x'),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  existsSync: jest.fn(() => true),
}))

const mockFetch = (impl: () => Promise<unknown>): jest.Mock => {
  const fn = jest.fn(impl)
  global.fetch = fn as unknown as typeof fetch
  return fn
}
const jsonResponse = (body: unknown, ok = true): Promise<unknown> => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body), text: () => Promise.resolve('#!/bin/sh') })
const redirectTo = (location: string | null): Promise<unknown> => Promise.resolve({
  ok: false,
  status: location === null ? 404 : 302,
  headers: { get: (name: string) => (name === 'location' ? location : null) },
  body: { cancel: jest.fn(() => Promise.resolve()) },
})

const setPlatform = (platform: string): void => { Object.defineProperty(process, 'platform', { value: platform }) }
const realPlatform = process.platform

describe('update utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isSea as jest.Mock).mockReturnValue(false)
    ;(execFileSync as jest.Mock).mockReset()
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
  })
  afterEach(() => { setPlatform(realPlatform) })

  test('isNewer compares versions numerically', () => {
    expect(isNewer('1.10.0', '1.9.1')).toBe(true)
    expect(isNewer('1.9.1', '1.9.1')).toBe(false)
    expect(isNewer('1.9.0', '1.9.1')).toBe(false)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
  })

  test('fetchLatestVersion reads the version from the releases/latest redirect', async () => {
    const fetchMock = mockFetch(() => redirectTo('https://github.com/mcKanses/missbetty/releases/tag/v1.10.0'))
    await expect(fetchLatestVersion()).resolves.toBe('1.10.0')
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://github.com/mcKanses/missbetty/releases/latest')
  })

  test('fetchLatestVersion returns null on errors and odd tags', async () => {
    mockFetch(() => redirectTo(null))
    await expect(fetchLatestVersion()).resolves.toBeNull()
    mockFetch(() => redirectTo('https://github.com/mcKanses/missbetty/releases/tag/nightly'))
    await expect(fetchLatestVersion()).resolves.toBeNull()
    mockFetch(() => Promise.reject(new Error('offline')))
    await expect(fetchLatestVersion()).resolves.toBeNull()
  })

  test('installMethod detects the standalone binary', () => {
    ;(isSea as jest.Mock).mockReturnValue(true)
    expect(installMethod()).toBe('binary')
  })

  test('installMethod treats a checkout outside node_modules as source', () => {
    expect(installMethod()).toBe('source')
  })

  test('installUpdate refuses to update a source checkout', async () => {
    await expect(installUpdate('1.10.0')).rejects.toThrow('source checkout')
    expect(execSync).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  test('installUpdate rejects anything but a plain version', async () => {
    await expect(installUpdate('1.10.0; rm -rf /')).rejects.toThrow(BettyError)
  })

  test('binary update on Linux/macOS runs the installer for that version into the current directory', async () => {
    setPlatform('linux')
    ;(isSea as jest.Mock).mockReturnValue(true)
    const fetchMock = mockFetch(() => jsonResponse({}))

    await installUpdate('1.10.0')

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/main\/install\.sh$/)
    const [cmd, args, opts] = (execFileSync as jest.Mock).mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(cmd).toBe('sh')
    expect(args[0]).toMatch(/install\.sh$/)
    expect(opts.env.BETTY_VERSION).toBe('v1.10.0')
    expect(opts.env.BETTY_SKIP_DEPS).toBe('true')
    expect(opts.env.BETTY_INSTALL_DIR).toBe(path.dirname(process.execPath))
  })

  test('binary update on Windows moves the running exe aside first and restores it on failure', async () => {
    setPlatform('win32')
    ;(isSea as jest.Mock).mockReturnValue(true)
    mockFetch(() => jsonResponse({}))
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(execFileSync as jest.Mock).mockImplementation(() => { throw new Error('installer failed') })

    await expect(installUpdate('1.10.0')).rejects.toThrow('left unchanged')

    const renames = (fs.renameSync as jest.Mock).mock.calls
    expect(renames[0]).toEqual([process.execPath, `${process.execPath}.old`])
    expect(renames[1]).toEqual([`${process.execPath}.old`, process.execPath])
    expect((execFileSync as jest.Mock).mock.calls[0][0]).toBe('powershell')
  })

  test('binary update on Windows does not pass PowerShell 7 module paths to Windows PowerShell', async () => {
    setPlatform('win32')
    ;(isSea as jest.Mock).mockReturnValue(true)
    mockFetch(() => jsonResponse({}))
    process.env.PSModulePath = 'C:\\Program Files\\PowerShell\\7\\Modules'
    try {
      await installUpdate('1.10.0')
    } finally {
      delete process.env.PSModulePath
    }
    const opts = (execFileSync as jest.Mock).mock.calls[0][2] as { env: NodeJS.ProcessEnv }
    expect(opts.env.PSModulePath).toBeUndefined()
    expect(opts.env.BETTY_VERSION).toBe('v1.10.0')
  })

  test('cleanupOldBinary removes the leftover exe on Windows only', () => {
    setPlatform('win32')
    ;(isSea as jest.Mock).mockReturnValue(true)
    cleanupOldBinary()
    expect(fs.rmSync).toHaveBeenCalledWith(`${process.execPath}.old`, { force: true })

    ;(fs.rmSync as jest.Mock).mockClear()
    setPlatform('linux')
    cleanupOldBinary()
    expect(fs.rmSync).not.toHaveBeenCalled()
  })
})
