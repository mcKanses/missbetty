import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import {
  addHostsEntry,
  checkDockerRunning,
  checkMkcertCaInstalled,
  installMkcertPackage,
  resolveSetupDomain,
  runMkcertInstall,
} from './setup'

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}))

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
}))

jest.mock('./config', () => ({
  __esModule: true,
  getDomainSuffix: jest.fn(() => '.localhost'),
}))

const originalPlatform = process.platform
const originalWslEnv = process.env.WSL_DISTRO_NAME

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('setup utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WSL_DISTRO_NAME = ''
    setPlatform('linux')
  })

  afterAll(() => {
    setPlatform(originalPlatform)
    if (originalWslEnv === undefined) delete process.env.WSL_DISTRO_NAME
    else process.env.WSL_DISTRO_NAME = originalWslEnv
  })

  test('checkDockerRunning returns false when docker is missing', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'docker --version') throw new Error('docker missing')
      return Buffer.from('')
    })

    expect(checkDockerRunning()).toBe(false)
    expect(execSync).toHaveBeenCalledWith('docker --version', { stdio: 'pipe' })
  })

  test('checkMkcertCaInstalled returns true when mkcert caroot contains root CA', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'mkcert -help') return Buffer.from('ok')
      if (String(cmd) === 'mkcert -CAROOT') return Buffer.from('/tmp/caroot')
      return Buffer.from('')
    })
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p).replace(/\\/g, '/').endsWith('/tmp/caroot/rootCA.pem')
    )

    expect(checkMkcertCaInstalled()).toBe(true)
  })

  test('resolveSetupDomain uses linked route domain when available', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => String(p).replace(/\\/g, '/').endsWith('/.betty/dynamic'))
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('http:\n  routers:\n    app:\n      rule: Host("app.dev")\n')

    expect(resolveSetupDomain()).toBe('app.dev')
  })

  test('resolveSetupDomain falls back to configured suffix when no route exists', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(resolveSetupDomain()).toBe('betty.localhost')
  })

  test('addHostsEntry returns WSL warning and does not try sudo', () => {
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('missing hosts') })

    const result = addHostsEntry('myapp.dev')

    expect(result.changed).toBe(false)
    expect(result.warning).toContain('WSL detected')
  })

  test('addHostsEntry appends hosts entry with sudo on Linux', () => {
    ;(fs.readFileSync as unknown as jest.Mock)
      .mockReturnValueOnce('127.0.0.1 localhost\n')
      .mockReturnValueOnce('127.0.0.1 localhost\n127.0.0.1 myapp.dev # added by betty\n')
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    const result = addHostsEntry('myapp.dev')

    expect(result).toEqual({ changed: true })
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('sudo sh -c'),
      { stdio: 'inherit' }
    )
  })

  test('runMkcertInstall returns warning when mkcert is missing', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'mkcert -help') throw new Error('missing')
      return Buffer.from('')
    })

    const result = runMkcertInstall()

    expect(result.ok).toBe(false)
    expect(result.warning).toContain('not installed')
  })

  test('installMkcertPackage installs mkcert via apt-get on Linux', () => {
    let installed = false
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') {
        if (!installed) throw new Error('missing')
        return Buffer.from('ok')
      }
      if (command.includes('command -v apt-get')) return Buffer.from('/usr/bin/apt-get')
      if (command === 'sudo apt-get install -y mkcert') {
        installed = true
        return Buffer.from('installed')
      }
      if (command.includes('command -v')) throw new Error('not found')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result).toEqual({ ok: true })
    expect(execSync).toHaveBeenCalledWith('sudo apt-get install -y mkcert', { stdio: 'inherit' })
  })
})
