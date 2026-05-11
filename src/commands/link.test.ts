import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import linkCommand, { suggestDomain, readExposedPorts } from './link'

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user', tmpdir: () => '/tmp' },
  homedir: () => '/home/test-user',
  tmpdir: () => '/tmp',
}))

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}))

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

const DOCKER_INSPECT = JSON.stringify([
  {
    NetworkSettings: {
      Networks: {
        betty_proxy: { IPAddress: '172.18.0.5' },
      },
    },
  },
])

beforeEach(() => {
  jest.resetAllMocks()
  ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue([])
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
})

describe('link command', () => {
  test('exits with 1 when proxy is not set up', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    await expect(linkCommand('myapp', { domain: 'myapp.localhost', port: '3000' })).rejects.toThrow(
      'process-exit-1'
    )
  })

  test('exits with 1 when port 443 is blocked by another Docker container', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker ps')) return Buffer.from('other-container\t0.0.0.0:443->443/tcp\n')
      return Buffer.from('')
    })

    await expect(linkCommand('myapp', { domain: 'myapp.localhost', port: '3000' })).rejects.toThrow(
      'process-exit-1'
    )
  })

  test('exits with 1 when no container name is provided', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve({ container: '', domain: 'myapp.localhost', port: '3000' })
    )

    await expect(linkCommand(undefined, { domain: 'myapp.localhost', port: '3000' })).rejects.toThrow(
      'process-exit-1'
    )
  })

  test('exits early when no containers are currently running', async () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(linkCommand(undefined, {})).rejects.toThrow('process-exit-1')
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })

  test('exits with 1 when invalid port is given', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(linkCommand('myapp', { domain: 'myapp.localhost', port: 'abc' })).rejects.toThrow(
      'process-exit-1'
    )
  })

  test('exits with 1 when domain is already linked', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('/.betty/dynamic') || normalized.endsWith('/existing.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['existing.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue([
      'http:',
      '  routers:',
      '    existing:',
      '      rule: \'Host("myapp.localhost")\'',
      '      entryPoints: [web]',
      '      service: existing',
    ].join('\n'))

    await expect(linkCommand('myapp', { domain: 'myapp.localhost', port: '3000' })).rejects.toThrow('process-exit-1')
  })

  test('writes route config and restarts traefik on success', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (c.includes('docker inspect')) return Buffer.from(DOCKER_INSPECT)
      if (c.includes('docker network inspect')) return Buffer.from('[]')
      return Buffer.from('')
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.localhost', port: '3000' })

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('myapp.yml'),
      expect.any(String),
      'utf8'
    )
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('restart traefik'),
      expect.any(Object)
    )

    logSpy.mockRestore()
  })

  test('hard fails when mkcert is missing for .dev domains', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('/myapp.dev.pem') || normalized.endsWith('/myapp.dev-key.pem')) return false
      return true
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (c.includes('docker inspect')) return Buffer.from(DOCKER_INSPECT)
      if (c.includes('docker network inspect')) return Buffer.from('[]')
      if (c.includes('mkcert -help')) throw new Error('mkcert missing')
      return Buffer.from('')
    })

    await expect(linkCommand('myapp', { domain: 'myapp.dev', port: '3000' })).rejects.toThrow('process-exit-1')
  })

  test('falls back to HTTP when mkcert is missing and HTTPS is not explicitly requested', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('/myapp.localhost.pem') || normalized.endsWith('/myapp.localhost-key.pem')) return false
      return true
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (c.includes('docker inspect')) return Buffer.from(DOCKER_INSPECT)
      if (c.includes('docker network inspect')) return Buffer.from('[]')
      if (c.includes('mkcert -help')) throw new Error('mkcert missing')
      return Buffer.from('')
    })

    await linkCommand('myapp', { domain: 'myapp.localhost', port: '3000' })

    const calledMkcertInstall = (execSync as unknown as jest.Mock).mock.calls
      .map((call) => String(call[0]))
      .some((command) => command.includes('mkcert -install'))
    expect(calledMkcertInstall).toBe(false)
  })

  test('does not apply changes in dry-run mode', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue([])

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.dev', port: '3000', dryRun: true })

    expect(logSpy).toHaveBeenCalledWith('Dry run: no changes were applied.')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })
})

describe('suggestDomain', () => {
  test('appends .dev to a simple name', () => {
    expect(suggestDomain('myapp')).toBe('myapp.dev')
  })

  test('strips trailing replica number', () => {
    expect(suggestDomain('myapp-1')).toBe('myapp.dev')
    expect(suggestDomain('frontend-12')).toBe('frontend.dev')
  })

  test('converts underscores to hyphens', () => {
    expect(suggestDomain('my_project')).toBe('my-project.dev')
  })

  test('lowercases the name', () => {
    expect(suggestDomain('MyApp')).toBe('myapp.dev')
  })

  test('handles Docker Compose service names with replica suffix', () => {
    expect(suggestDomain('myapp-web-1')).toBe('myapp-web.dev')
    expect(suggestDomain('my_project-backend-2')).toBe('my-project-backend.dev')
  })

  test('uses compose service and project labels for subdomain suggestion', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker inspect')) return Buffer.from(JSON.stringify([
        {
          Config: {
            Labels: {
              'com.docker.compose.project': 'mckanses-auth',
              'com.docker.compose.service': 'ory-ui',
            },
          },
        },
      ]))
      return Buffer.from('')
    })

    expect(suggestDomain('mckanses-auth-ory-ui-1')).toBe('ory-ui.mckanses-auth.dev')
  })

  test('respects configured domain suffix from environment', () => {
    const previous = process.env.BETTY_DOMAIN_SUFFIX
    process.env.BETTY_DOMAIN_SUFFIX = '.localhost'

    expect(suggestDomain('myapp')).toBe('myapp.localhost')

    process.env.BETTY_DOMAIN_SUFFIX = previous
  })
})

describe('ensureHostsEntry (via linkCommand with non-localhost domain)', () => {
  const originalPlatform = process.platform

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  const mockSetupForHostsEntry = (): void => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('/myapp.test.pem') || normalized.endsWith('/myapp.test-key.pem')) return false
      return true
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker ps --filter')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (c.includes('docker inspect myapp')) return Buffer.from(DOCKER_INSPECT)
      if (c.includes('docker network inspect')) return Buffer.from('[{}]')
      if (c.includes('mkcert -help')) throw new Error('mkcert not installed')
      return Buffer.from('')
    })
  }

  test('returns true when hosts entry already exists on Linux', async () => {
    setPlatform('linux')
    mockSetupForHostsEntry()
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('/etc/hosts')) return '127.0.0.1 myapp.test # added by betty\n'
      return ''
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.test', port: '3000' })

    expect(fs.appendFileSync).not.toHaveBeenCalled()
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).not.toContain('Could not add hosts entry')
    expect(output).not.toContain('only reachable after the hosts entry')

    logSpy.mockRestore()
  })

  test('adds hosts entry via appendFileSync when entry is missing on Linux', async () => {
    setPlatform('linux')
    mockSetupForHostsEntry()
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('/etc/hosts')) return '127.0.0.1 localhost\n'
      return ''
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.test', port: '3000' })

    expect(fs.appendFileSync).toHaveBeenCalledWith('/etc/hosts', expect.stringContaining('myapp.test'), 'utf8')
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Added hosts entry')
    expect(output).not.toContain('only reachable after the hosts entry')

    logSpy.mockRestore()
  })

  test('prints manual hint when appendFileSync fails on Linux', async () => {
    setPlatform('linux')
    mockSetupForHostsEntry()
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('/etc/hosts')) return '127.0.0.1 localhost\n'
      return ''
    })
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.test', port: '3000' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Could not add hosts entry automatically')
    expect(output).toContain('myapp.test')

    logSpy.mockRestore()
  })

  test('writes PS1 script and returns true when PowerShell elevation succeeds on Windows', async () => {
    setPlatform('win32')
    mockSetupForHostsEntry()
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    let hostsReadCount = 0
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = String(p).replace(/\\/g, '/')
      if (np.includes('drivers/etc/hosts')) {
        hostsReadCount++
        return hostsReadCount === 1
          ? '127.0.0.1 localhost\n'
          : '127.0.0.1 localhost\n127.0.0.1 myapp.test # added by betty\n'
      }
      return ''
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.test', port: '3000' })

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.ps1'),
      expect.stringContaining('myapp.test'),
      'utf8'
    )
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('Start-Process PowerShell -Verb RunAs'),
      expect.objectContaining({ stdio: 'inherit' })
    )
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.ps1'))
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).not.toContain('only reachable after the hosts entry')

    logSpy.mockRestore()
  })

  test('cleans up PS1 script and prints manual hint when PowerShell elevation fails on Windows', async () => {
    setPlatform('win32')
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('/myapp.test.pem') || normalized.endsWith('/myapp.test-key.pem')) return false
      return true
    })
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').includes('drivers/etc/hosts')) return '127.0.0.1 localhost\n'
      return ''
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const c = String(cmd)
      if (c.includes('docker ps --filter')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (c.includes('docker inspect myapp')) return Buffer.from(DOCKER_INSPECT)
      if (c.includes('docker network inspect')) return Buffer.from('[{}]')
      if (c.includes('mkcert -help')) throw new Error('mkcert not installed')
      if (c.includes('Start-Process PowerShell -Verb RunAs')) throw new Error('elevation failed')
      return Buffer.from('')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await linkCommand('myapp', { domain: 'myapp.test', port: '3000' })

    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.ps1'))
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Could not add hosts entry automatically')

    logSpy.mockRestore()
  })
})

describe('readExposedPorts', () => {
  test('returns sorted port list from ExposedPorts', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(JSON.stringify([
      {
        NetworkSettings: { Networks: {} },
        State: {},
        RestartCount: 0,
        Config: {
          Labels: {},
          ExposedPorts: { '8080/tcp': {}, '3000/tcp': {}, '443/tcp': {} },
        },
      },
    ])))

    expect(readExposedPorts('myapp')).toEqual([443, 3000, 8080])
  })

  test('returns empty array when docker inspect fails', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('not found') })

    expect(readExposedPorts('missing')).toEqual([])
  })

  test('returns empty array when ExposedPorts is absent', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(JSON.stringify([
      {
        NetworkSettings: { Networks: {} },
        State: {},
        RestartCount: 0,
        Config: { Labels: {} },
      },
    ])))

    expect(readExposedPorts('myapp')).toEqual([])
  })
})

