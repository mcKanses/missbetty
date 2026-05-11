import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import relinkCommand from './relink'

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
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    unlinkSync: jest.fn(),
    appendFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  appendFileSync: jest.fn(),
}))

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

const YAML_APP_ROUTE = [
  'http:',
  '  routers:',
  '    app:',
  '      rule: \'Host("app.localhost")\'',
  '      entryPoints: [web]',
  '      service: app',
  '  services:',
  '    app:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://172.18.0.2:5173',
].join('\n')

const YAML_OTHER_ROUTE = [
  'http:',
  '  routers:',
  '    other:',
  '      rule: \'Host("used.localhost")\'',
  '      entryPoints: [web]',
  '      service: other',
  '  services:',
  '    other:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://172.18.0.9:5173',
].join('\n')

const normalizePath = (p: string) => p.replace(/\\/g, '/')

const DOCKER_INSPECT_WITH_NETWORK = JSON.stringify([{
  NetworkSettings: {
    Networks: {
      betty_proxy: { IPAddress: '172.18.0.3' },
    },
  },
}])

describe('relink command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('logs error and exits when Betty proxy is not set up', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(relinkCommand()).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Betty's proxy is not set up yet. Run: betty serve"))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('logs "No links found." when dynamic dir has no routes', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml')
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand()

    expect(logSpy).toHaveBeenCalledWith('No links found.')
    expect(execSync).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('relinks route with provided opts without prompting', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/certs') ||
        np.endsWith('/myapp.pem') ||
        np.endsWith('/myapp-key.pem')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      return Buffer.from('')
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'newapp.localhost', port: '3000' })

    // prompt is called with empty array when all opts are provided (no interactive fields)
    expect(inquirer.prompt).toHaveBeenCalledWith([])
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('myapp.yml'),
      expect.any(String),
      'utf8'
    )
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('restart traefik'),
      expect.objectContaining({ stdio: 'inherit' })
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Updated link:'))

    logSpy.mockRestore()
  })

  test('skips route list prompt when only one link exists', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/certs') ||
        np.endsWith('/myapp.pem') ||
        np.endsWith('/myapp-key.pem')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve({ container: 'myapp', domain: 'newapp.localhost', port: '3000' })
    )
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      return Buffer.from('')
    })

    await relinkCommand()

    expect(inquirer.prompt).toHaveBeenCalledTimes(1)
    expect(inquirer.prompt).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'container' }),
      expect.objectContaining({ name: 'domain' }),
      expect.objectContaining({ name: 'port' }),
    ]))
  })

  test('exits when container name is empty', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    // prompt returns empty container name
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({
      container: '',
      domain: 'newapp.localhost',
      port: '3000',
    }))

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(relinkCommand('app')).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No container provided.'))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('exits when port is invalid', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(
      relinkCommand('app', { container: 'myapp', domain: 'newapp.localhost', port: 'notanumber' })
    ).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid port. Example: --port 3000'))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('exits when target domain is already linked by another route', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/dynamic/other.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'other.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      if (np.endsWith('/other.yml')) return YAML_OTHER_ROUTE
      return YAML_APP_ROUTE
    })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(relinkCommand('app', { container: 'app', domain: 'used.localhost', port: '80' })).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Domain 'used.localhost' is already linked"))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('shows route selection prompt when multiple routes exist and no target is given', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/dynamic/other.yml') ||
        np.endsWith('/.betty/certs') ||
        np.endsWith('/myapp.pem') ||
        np.endsWith('/myapp-key.pem')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'other.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      if (np.endsWith('/other.yml')) return YAML_OTHER_ROUTE
      return YAML_APP_ROUTE
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd).startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      return Buffer.from('')
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      const qs = questions as { name: string }[]
      if (qs.some((q) => q.name === 'route')) return Promise.resolve({ route: '/home/test-user/.betty/dynamic/app.yml' })
      return Promise.resolve({ container: 'myapp', domain: 'newapp.localhost', port: '3000' })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand()

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'route' })])
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('myapp.yml'),
      expect.any(String),
      'utf8'
    )

    logSpy.mockRestore()
  })

  test('resolves route by domain name without showing selection prompt', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/dynamic/other.yml') ||
        np.endsWith('/.betty/certs') ||
        np.endsWith('/myapp.pem') ||
        np.endsWith('/myapp-key.pem')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'other.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      if (np.endsWith('/other.yml')) return YAML_OTHER_ROUTE
      return YAML_APP_ROUTE
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd).startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      return Buffer.from('')
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app.localhost', { container: 'myapp', domain: 'newapp.localhost', port: '3000' })

    expect(inquirer.prompt).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'route' })])
    )
    expect(fs.writeFileSync).toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('exits when domain resolves to empty string', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(
      relinkCommand('app', { container: 'myapp', domain: '', port: '3000' })
    ).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No domain provided.'))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('logs HTTPS confirmation when certificate exists for the domain', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/certs') ||
        np.endsWith('/newapp.localhost.pem') ||
        np.endsWith('/newapp.localhost-key.pem')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd).startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      return Buffer.from('')
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'newapp.localhost', port: '3000' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('HTTPS is available at https://newapp.localhost')

    logSpy.mockRestore()
  })

  test('prompt validate functions reject empty domain and non-numeric port', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/certs')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      if (String(cmd).startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      if (String(cmd).includes('mkcert -help')) throw new Error('mkcert not installed')
      return Buffer.from('')
    })

    interface PromptQuestion { name: string; validate?: (v: string) => boolean | string }
    let capturedQuestions: PromptQuestion[] = []
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      capturedQuestions = questions as PromptQuestion[]
      return Promise.resolve({ container: 'myapp', domain: 'newapp.localhost', port: '3000' })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand()

    const domainQ = capturedQuestions.find((q) => q.name === 'domain')
    const portQ = capturedQuestions.find((q) => q.name === 'port')

    expect(domainQ?.validate?.('')).toBe('Domain cannot be empty')
    expect(domainQ?.validate?.('app.localhost')).toBe(true)
    expect(portQ?.validate?.('abc')).toBe('Please provide a valid port')
    expect(portQ?.validate?.('0')).toBe('Please provide a valid port')
    expect(portQ?.validate?.('3000')).toBe(true)

    logSpy.mockRestore()
  })

  test('hard fails when mkcert is missing for .dev domains', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/certs')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      if (command.includes('mkcert -help')) throw new Error('mkcert missing')
      return Buffer.from('')
    })

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(relinkCommand('app', { container: 'myapp', domain: 'newapp.dev', port: '3000' })).rejects.toThrow('process-exit-1')

    exitSpy.mockRestore()
  })
})

describe('ensureHostsEntry (via relinkCommand with non-localhost domain)', () => {
  const originalPlatform = process.platform

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  beforeEach(() => {
    jest.resetAllMocks()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  const mockBaseSetup = (): void => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/certs')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      if (command.includes('mkcert -help')) throw new Error('mkcert not installed')
      return Buffer.from('')
    })
  }

  test('returns true when hosts entry already exists on Linux', async () => {
    setPlatform('linux')
    mockBaseSetup()
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('/etc/hosts')) return '127.0.0.1 myapp.test # added by betty\n'
      return YAML_APP_ROUTE
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'myapp.test', port: '3000' })

    expect(fs.appendFileSync).not.toHaveBeenCalled()
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).not.toContain('Could not add hosts entry')
    expect(output).not.toContain('only reachable after the hosts entry')

    logSpy.mockRestore()
  })

  test('adds hosts entry via appendFileSync when entry is missing on Linux', async () => {
    setPlatform('linux')
    mockBaseSetup()
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('/etc/hosts')) return '127.0.0.1 localhost\n'
      return YAML_APP_ROUTE
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'myapp.test', port: '3000' })

    expect(fs.appendFileSync).toHaveBeenCalledWith('/etc/hosts', expect.stringContaining('myapp.test'), 'utf8')
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Added hosts entry')
    expect(output).not.toContain('only reachable after the hosts entry')

    logSpy.mockRestore()
  })

  test('prints manual hint when appendFileSync fails on Linux', async () => {
    setPlatform('linux')
    mockBaseSetup()
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('/etc/hosts')) return '127.0.0.1 localhost\n'
      return YAML_APP_ROUTE
    })
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'myapp.test', port: '3000' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Could not add hosts entry automatically')
    expect(output).toContain('myapp.test')

    logSpy.mockRestore()
  })

  test('writes PS1 script and returns true when PowerShell elevation succeeds on Windows', async () => {
    setPlatform('win32')
    mockBaseSetup()
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    let hostsReadCount = 0
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      if (np.includes('drivers/etc/hosts')) {
        hostsReadCount++
        return hostsReadCount === 1
          ? '127.0.0.1 localhost\n'
          : '127.0.0.1 localhost\n127.0.0.1 myapp.test # added by betty\n'
      }
      return YAML_APP_ROUTE
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'myapp.test', port: '3000' })

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
    mockBaseSetup()
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).includes('drivers/etc/hosts')) return '127.0.0.1 localhost\n'
      return YAML_APP_ROUTE
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.startsWith('docker inspect')) return Buffer.from(DOCKER_INSPECT_WITH_NETWORK)
      if (command.includes('mkcert -help')) throw new Error('mkcert not installed')
      if (command.includes('Start-Process PowerShell -Verb RunAs')) throw new Error('elevation failed')
      return Buffer.from('')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await relinkCommand('app', { container: 'myapp', domain: 'myapp.test', port: '3000' })

    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.ps1'))
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Could not add hosts entry automatically')

    logSpy.mockRestore()
  })
})
