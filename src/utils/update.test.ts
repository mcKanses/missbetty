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
  rmSync: jest.fn(),
}))

const mockFetch = (impl: () => Promise<unknown>): jest.Mock => {
  const fn = jest.fn(impl)
  global.fetch = fn as unknown as typeof fetch
  return fn
}
const scriptResponse = (): Promise<unknown> => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('#!/bin/sh') })
const redirectTo = (location: string | null): Promise<unknown> => Promise.resolve({
  ok: false,
  status: location === null ? 404 : 302,
  headers: { get: (name: string) => (name === 'location' ? location : null) },
  body: { cancel: jest.fn(() => Promise.resolve()) },
})

const realPlatform = process.platform
const realExecPath = process.execPath
const setPlatform = (platform: string): void => { Object.defineProperty(process, 'platform', { value: platform }) }
const setExecPath = (p: string): void => { Object.defineProperty(process, 'execPath', { value: p, configurable: true }) }

describe('update utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isSea as jest.Mock).mockReturnValue(false)
    ;(execFileSync as jest.Mock).mockReset()
  })
  afterEach(() => {
    setPlatform(realPlatform)
    setExecPath(realExecPath)
  })

  test('isNewer compares versions numerically', () => {
    expect(isNewer('1.10.0', '1.9.1')).toBe(true)
    expect(isNewer('1.9.1', '1.9.1')).toBe(false)
    expect(isNewer('1.9.0', '1.9.1')).toBe(false)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
  })

  test('isNewer treats a prerelease as older than its release', () => {
    expect(isNewer('1.10.0', '1.10.0-rc.1')).toBe(true)
    expect(isNewer('1.10.0-rc.1', '1.10.0')).toBe(false)
    expect(isNewer('1.11.0', '1.10.0-rc.1')).toBe(true)
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

  test('installMethod tells the binary, the package managers and a checkout apart', () => {
    expect(installMethod('/home/me/missbetty/bin/utils')).toBe('source')
    expect(installMethod('/usr/local/lib/node_modules/missbetty/bin/utils')).toBe('npm')
    expect(installMethod('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\missbetty\\bin\\utils')).toBe('npm')
    expect(installMethod('/home/me/.npm/_npx/1a2b/node_modules/missbetty/bin/utils')).toBe('npx')
    expect(installMethod('/home/me/.local/share/pnpm/global/5/node_modules/.pnpm/missbetty@1.9.1/node_modules/missbetty/bin/utils')).toBe('pnpm')
    expect(installMethod('/home/me/.bun/install/global/node_modules/missbetty/bin/utils')).toBe('bun')
    expect(installMethod('/home/me/.config/yarn/global/node_modules/missbetty/bin/utils')).toBe('yarn')
    ;(isSea as jest.Mock).mockReturnValue(true)
    expect(installMethod('/whatever')).toBe('binary')
  })

  test('installUpdate refuses to update a source checkout', async () => {
    await expect(installUpdate('1.10.0')).rejects.toThrow('source checkout')
    expect(execSync).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  test('installUpdate rejects anything but a plain version', async () => {
    await expect(installUpdate('1.10.0; rm -rf /')).rejects.toThrow(BettyError)
  })

  test('binary update on Linux/macOS runs the installer of that release into the current directory', async () => {
    setPlatform('linux')
    setExecPath('/usr/local/bin/betty')
    ;(isSea as jest.Mock).mockReturnValue(true)
    const fetchMock = mockFetch(scriptResponse)

    await installUpdate('1.10.0')

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://raw.githubusercontent.com/mcKanses/missbetty/v1.10.0/install.sh')
    const [cmd, args, opts] = (execFileSync as jest.Mock).mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(cmd).toBe('sh')
    expect(args[0]).toMatch(/install\.sh$/)
    expect(opts.env).toEqual(expect.objectContaining({
      BETTY_VERSION: 'v1.10.0',
      BETTY_SKIP_DEPS: 'true',
      BETTY_SKIP_PATH: 'true',
      BETTY_INSTALL_DIR: path.dirname('/usr/local/bin/betty'),
    }))
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/betty-update-x', { recursive: true, force: true })
  })

  test('binary update on Windows runs install.ps1 without PowerShell 7 module paths', async () => {
    setPlatform('win32')
    setExecPath('C:\\Users\\me\\AppData\\Local\\Programs\\betty\\betty.exe')
    ;(isSea as jest.Mock).mockReturnValue(true)
    const fetchMock = mockFetch(scriptResponse)
    process.env.PSModulePath = 'C:\\Program Files\\PowerShell\\7\\Modules'
    try {
      await installUpdate('1.10.0')
    } finally {
      delete process.env.PSModulePath
    }
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/v1\.10\.0\/install\.ps1$/)
    const [cmd, , opts] = (execFileSync as jest.Mock).mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(cmd).toBe('powershell')
    expect(opts.env.PSModulePath).toBeUndefined()
    expect(opts.env.BETTY_VERSION).toBe('v1.10.0')
  })

  test('a failed installer is reported and its temp directory removed', async () => {
    setPlatform('linux')
    setExecPath('/usr/local/bin/betty')
    ;(isSea as jest.Mock).mockReturnValue(true)
    mockFetch(scriptResponse)
    ;(execFileSync as jest.Mock).mockImplementation(() => { throw new Error('installer failed') })

    await expect(installUpdate('1.10.0')).rejects.toThrow('left unchanged')
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/betty-update-x', { recursive: true, force: true })
  })

  test('the installer does not run for a renamed binary', async () => {
    setPlatform('linux')
    setExecPath('/home/me/Downloads/betty-linux-x64')
    ;(isSea as jest.Mock).mockReturnValue(true)
    mockFetch(scriptResponse)

    await expect(installUpdate('1.10.0')).rejects.toThrow('named betty-linux-x64')
    expect(execFileSync).not.toHaveBeenCalled()
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
