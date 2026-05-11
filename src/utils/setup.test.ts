import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import {
  addHostsEntry,
  checkDockerRunning,
  checkMkcertCaInstalled,
  collectSetupStatus,
  getHostsPath,
  installMkcertPackage,
  printDockerInstallInstructions,
  printMkcertInstallInstructions,
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

  test('getHostsPath returns the Linux hosts file path on Linux', () => {
    setPlatform('linux')
    expect(getHostsPath()).toBe('/etc/hosts')
  })

  test('getHostsPath returns the Windows hosts file path on Windows', () => {
    setPlatform('win32')
    expect(getHostsPath()).toBe('C:\\Windows\\System32\\drivers\\etc\\hosts')
  })

  test('addHostsEntry returns warning on Windows instead of writing directly', () => {
    setPlatform('win32')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\n')

    const result = addHostsEntry('myapp.dev')

    expect(result.changed).toBe(false)
    expect(result.warning).toContain('Windows detected')
    expect(execSync).not.toHaveBeenCalled()
  })

  test('installMkcertPackage returns ok immediately when mkcert is already installed', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'mkcert -help') return Buffer.from('ok')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result).toEqual({ ok: true })
    expect(execSync).toHaveBeenCalledTimes(1)
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

  test('installMkcertPackage installs mkcert via brew on macOS', () => {
    setPlatform('darwin')
    let installed = false
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') {
        if (!installed) throw new Error('missing')
        return Buffer.from('ok')
      }
      if (command.includes('command -v brew')) return Buffer.from('/usr/local/bin/brew')
      if (command === 'brew install mkcert') {
        installed = true
        return Buffer.from('installed')
      }
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result).toEqual({ ok: true })
    expect(execSync).toHaveBeenCalledWith('brew install mkcert', { stdio: 'inherit' })
  })

  test('installMkcertPackage returns warning when brew is not available on macOS', () => {
    setPlatform('darwin')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') throw new Error('missing')
      if (command.includes('command -v brew')) throw new Error('not found')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result.ok).toBe(false)
    expect(result.warning).toContain('Homebrew')
  })

  test('installMkcertPackage installs mkcert via winget on Windows', () => {
    setPlatform('win32')
    let installed = false
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') {
        if (!installed) throw new Error('missing')
        return Buffer.from('ok')
      }
      if (command === 'winget --version') return Buffer.from('v1.0')
      if (command.includes('winget install')) {
        installed = true
        return Buffer.from('installed')
      }
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result).toEqual({ ok: true })
    expect(execSync).toHaveBeenCalledWith('winget install --id FiloSottile.mkcert -e', { stdio: 'inherit' })
  })

  test('installMkcertPackage returns warning when winget is not available on Windows', () => {
    setPlatform('win32')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') throw new Error('missing')
      if (command === 'winget --version') throw new Error('not found')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result.ok).toBe(false)
    expect(result.warning).toContain('winget')
  })

  test('printMkcertInstallInstructions mentions brew on macOS', () => {
    setPlatform('darwin')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printMkcertInstallInstructions()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('brew install mkcert')

    logSpy.mockRestore()
  })

  test('printMkcertInstallInstructions mentions winget on Windows', () => {
    setPlatform('win32')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printMkcertInstallInstructions()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('winget')

    logSpy.mockRestore()
  })

  test('printMkcertInstallInstructions mentions apt on Linux', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printMkcertInstallInstructions()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('apt')

    logSpy.mockRestore()
  })

  test('printDockerInstallInstructions mentions Docker Desktop on macOS', () => {
    setPlatform('darwin')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printDockerInstallInstructions()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Docker')

    logSpy.mockRestore()
  })

  test('printDockerInstallInstructions mentions Docker Desktop on Windows', () => {
    setPlatform('win32')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printDockerInstallInstructions()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Docker Desktop')

    logSpy.mockRestore()
  })

  test('printDockerInstallInstructions mentions docs link on Linux', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printDockerInstallInstructions()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('docker.com')

    logSpy.mockRestore()
  })

  test('checkMkcertCaInstalled returns false when mkcert -CAROOT throws', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'mkcert -help') return Buffer.from('ok')
      if (String(cmd) === 'mkcert -CAROOT') throw new Error('caroot failed')
      return Buffer.from('')
    })

    expect(checkMkcertCaInstalled()).toBe(false)
  })

  test('resolveSetupDomain falls back to suffix when dynamic files have no Host rule', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p).replace(/\\/g, '/').endsWith('/.betty/dynamic')
    )
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('http:\n  routers:\n    app:\n      rule: PathPrefix("/")\n')

    expect(resolveSetupDomain()).toBe('betty.localhost')
  })

  test('addHostsEntry returns unverified warning when hosts entry is not found after sudo', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\n')
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    const result = addHostsEntry('myapp.dev')

    expect(result.changed).toBe(false)
    expect(result.warning).toContain('Could not verify')
  })

  test('addHostsEntry returns failure warning when sudo append throws', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\n')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd).includes('sudo sh -c')) throw new Error('sudo failed')
      return Buffer.from('')
    })

    const result = addHostsEntry('myapp.dev')

    expect(result.changed).toBe(false)
    expect(result.warning).toContain('Failed to append')
  })

  test('runMkcertInstall returns mkcert-install-failed warning when mkcert -install throws', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'mkcert -help') return Buffer.from('ok')
      if (String(cmd) === 'mkcert -install') throw new Error('install failed')
      return Buffer.from('')
    })

    const result = runMkcertInstall()

    expect(result.ok).toBe(false)
    expect(result.warning).toBe('mkcert -install failed.')
  })

  test('installMkcertPackage installs mkcert via apt on Linux when apt-get is missing', () => {
    let installed = false
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') {
        if (!installed) throw new Error('missing')
        return Buffer.from('ok')
      }
      if (command.includes('command -v apt-get')) throw new Error('not found')
      if (command.includes('command -v apt')) return Buffer.from('/usr/bin/apt')
      if (command === 'sudo apt install -y mkcert') { installed = true; return Buffer.from('installed') }
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result).toEqual({ ok: true })
    expect(execSync).toHaveBeenCalledWith('sudo apt install -y mkcert', { stdio: 'inherit' })
  })

  test('installMkcertPackage installs mkcert via pacman on Linux', () => {
    let installed = false
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') {
        if (!installed) throw new Error('missing')
        return Buffer.from('ok')
      }
      if (command.includes('command -v apt-get')) throw new Error('not found')
      if (command.includes('command -v apt')) throw new Error('not found')
      if (command.includes('command -v pacman')) return Buffer.from('/usr/bin/pacman')
      if (command === 'sudo pacman -S --noconfirm mkcert') { installed = true; return Buffer.from('installed') }
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result).toEqual({ ok: true })
    expect(execSync).toHaveBeenCalledWith('sudo pacman -S --noconfirm mkcert', { stdio: 'inherit' })
  })

  test('installMkcertPackage returns warning on Linux when no supported package manager is found', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') throw new Error('missing')
      if (command.includes('command -v')) throw new Error('not found')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result.ok).toBe(false)
    expect(result.warning).toContain('No supported package manager')
  })

  test('installMkcertPackage returns not-supported warning on unknown platform', () => {
    setPlatform('freebsd')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd) === 'mkcert -help') throw new Error('missing')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result.ok).toBe(false)
    expect(result.warning).toContain('not supported on this platform')
  })

  test('installMkcertPackage returns installation-failed warning when execSync throws during install', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') throw new Error('missing')
      if (command.includes('command -v apt-get')) return Buffer.from('/usr/bin/apt-get')
      if (command.includes('apt-get install')) throw new Error('apt failed')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result.ok).toBe(false)
    expect(result.warning).toBe('Automatic mkcert installation failed.')
  })

  test('installMkcertPackage returns still-not-found warning when mkcert is missing after install', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'mkcert -help') throw new Error('missing')
      if (command.includes('command -v apt-get')) return Buffer.from('/usr/bin/apt-get')
      if (command === 'sudo apt-get install -y mkcert') return Buffer.from('installed')
      return Buffer.from('')
    })

    const result = installMkcertPackage()

    expect(result.ok).toBe(false)
    expect(result.warning).toContain('still not found')
  })

  test('collectSetupStatus returns a complete status object', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command === 'docker --version') return Buffer.from('Docker version 24')
      if (command === 'docker info') return Buffer.from('ok')
      if (command === 'mkcert -help') return Buffer.from('ok')
      if (command === 'mkcert -CAROOT') return Buffer.from('/tmp/caroot')
      return Buffer.from('')
    })
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    const status = collectSetupStatus()

    expect(status).toMatchObject({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      domain: expect.any(String),
    })
  })
})
