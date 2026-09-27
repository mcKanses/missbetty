import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execFileSync, execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { BettyError } from '../utils/errors'
import inquirer from 'inquirer'
import devCommand, { readDevProjectConfig } from './dev'
import * as lockModule from '../utils/lock'

const { lockState } = lockModule as unknown as { lockState: { held: boolean } }

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}))

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn(),
  spawnSync: jest.fn(),
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    readdirSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  readdirSync: jest.fn(),
}))

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

// Pass-through lock that records whether it is currently held, so tests can
// assert which work runs under the lock.
jest.mock('../utils/lock', () => {
  const lockState = { held: false }
  return {
    __esModule: true,
    lockState,
    withLock: (fn: () => unknown) => {
      lockState.held = true
      try { return fn() } finally { lockState.held = false }
    },
    withLockAsync: async (fn: () => Promise<unknown>) => {
      lockState.held = true
      try { return await fn() } finally { lockState.held = false }
    },
  }
})

const SAMPLE_CONFIG = [
  'project: mckanses-auth',
  'up:',
  '  command: docker compose up -d',
  'domains:',
  '  - host: ory-ui.mckansescloud.dev',
  '    target: http://127.0.0.1:5173',
  'https:',
  '  enabled: true',
  '  certificateAuthority: missbetty',
  'permissions:',
  '  hosts: allowed',
  '  trustStore: allowed',
  '  docker: allowed',
].join('\n')

beforeEach(() => {
  jest.resetAllMocks()
  // Route execFileSync (docker/mkcert helpers) through the execSync mock, so tests
  // can match on the command line.
  ;(execFileSync as unknown as jest.Mock).mockImplementation((file: unknown, args: unknown, opts: unknown) =>
    (execSync as unknown as jest.Mock)(String(file) + " " + (Array.isArray(args) ? args.join(" ") : ""), opts)
  )
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
  ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: null, status: 0 })
})

describe('readDevProjectConfig', () => {
  test('parses a valid .betty.yml', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(SAMPLE_CONFIG)

    const config = readDevProjectConfig('/project/.betty.yml')

    expect(config.project).toBe('mckanses-auth')
    expect(config.domains).toEqual([
      { host: 'ory-ui.mckansescloud.dev', target: 'http://127.0.0.1:5173' },
    ])
    expect(config.permissions?.docker).toBe('allowed')
  })

  test('rejects non-http targets', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue([
      'project: bad',
      'domains:',
      '  - host: bad.localhost',
      '    target: tcp://127.0.0.1:1234',
    ].join('\n'))

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('target must be an http(s) URL')
  })

  test('throws for invalid permission mode', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      SAMPLE_CONFIG.replace('hosts: allowed', 'hosts: banana')
    )

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow("Invalid permission mode 'banana'")
  })

  test('throws for non-scalar permission value', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue([
      'project: app',
      'domains:',
      '  - host: app.localhost',
      '    target: http://127.0.0.1:3000',
      'permissions:',
      '  hosts:',
      '    - allowed',
      '    - denied',
    ].join('\n'))

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow("Invalid permission mode 'non-scalar value'")
  })

  test('throws when YAML root is not an object', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('null')

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('.betty.yml must contain a YAML object.')
  })

  test('throws for missing project name', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      'domains:\n  - host: a.localhost\n    target: http://127.0.0.1:3000\n'
    )

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('.betty.yml requires a non-empty project name.')
  })

  test('throws for empty domains array', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('project: app\ndomains: []\n')

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('.betty.yml requires at least one domain.')
  })

  test('throws for non-object domain entry', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      'project: app\ndomains:\n  - just-a-string\n'
    )

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('domains[0] must be an object.')
  })

  test('throws for missing host in domain', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      'project: app\ndomains:\n  - target: http://127.0.0.1:3000\n'
    )

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('domains[0].host is required.')
  })

  test('accepts an existing host with an underscore', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      'project: app\ndomains:\n  - host: api_v2.localhost\n    target: http://127.0.0.1:3000\n'
    )

    expect(readDevProjectConfig('/project/.betty.yml').domains[0].host).toBe('api_v2.localhost')
  })

  test('throws for a host that is not a valid hostname', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      "project: app\ndomains:\n  - host: 'a$(id).dev'\n    target: http://127.0.0.1:3000\n"
    )

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow("domains[0].host: Invalid domain 'a$(id).dev'")
  })

  test('throws for missing target in domain', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      'project: app\ndomains:\n  - host: app.localhost\n'
    )

    expect(() => readDevProjectConfig('/project/.betty.yml')).toThrow('domains[0].target is required.')
  })
})

describe('dev command', () => {
  test('prints parsed config in dry-run mode', async () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(SAMPLE_CONFIG)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml', dryRun: true })

    expect(logSpy).toHaveBeenCalledWith('Project: mckanses-auth')
    expect(execSync).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('maps an IPv6 loopback target to host.docker.internal', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG.replace('http://127.0.0.1:5173', 'http://[::1]:5173')
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml' })

    const routeWrite = (fs.writeFileSync as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).replace(/\\/g, '/').endsWith('/.betty/dynamic/mckanses-auth.yml')
    )
    expect(routeWrite?.[1]).toContain('http://host.docker.internal:5173')
  })

  test('writes project route with host.docker.internal target for loopback services', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml' })

    const routeWrite = (fs.writeFileSync as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).replace(/\\/g, '/').endsWith('/.betty/dynamic/mckanses-auth.yml')
    )
    expect(routeWrite?.[1]).toContain('http://host.docker.internal:5173')
    expect(spawnSync).toHaveBeenCalledWith('docker compose up -d', expect.objectContaining({
      shell: true,
      cwd: expect.any(String),
    }))

    logSpy.mockRestore()
  })

  test('fails when prompt permission is denied', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(SAMPLE_CONFIG.replace('docker: allowed', 'docker: prompt'))
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ ok: false } as never)
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
  })

  test('auto-discovers .betty.yml when no config path is given', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p).replace(/\\/g, '/').endsWith('.betty.yml')
    )
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(SAMPLE_CONFIG)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ dryRun: true })

    expect(logSpy).toHaveBeenCalledWith('Project: mckanses-auth')

    logSpy.mockRestore()
  })

  test('exits when no config file is found in the current directory', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    await expect(devCommand({ dryRun: true })).rejects.toThrow(BettyError)
  })

  test('exits when docker permission is set to manual', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      SAMPLE_CONFIG.replace('docker: allowed', 'docker: manual')
    )
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
  })

  test('adds hosts entry and exits when docker permission is denied', async () => {
    const CONFIG_NO_HTTPS = [
      'project: test',
      'domains:',
      '  - host: test.dev',
      '    target: http://127.0.0.1:3000',
      'permissions:',
      '  hosts: allowed',
      '  docker: denied',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('.betty.yml')) return CONFIG_NO_HTTPS
      return ''
    })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
  })

  test('shows checkbox for multiple missing hosts entries and adds only selected domains', async () => {
    const MULTI_DOMAIN_CONFIG = [
      'project: test',
      'domains:',
      '  - host: ui.dev',
      '    target: http://127.0.0.1:5173',
      '  - host: api.dev',
      '    target: http://127.0.0.1:8080',
      'permissions:',
      '  hosts: prompt',
      '  docker: denied',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('.betty.yml')) return MULTI_DOMAIN_CONFIG
      return ''
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ hosts: ['ui.dev'] } as never)

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)

    const checkboxCall = (inquirer.prompt as unknown as jest.Mock).mock.calls.find(
      (call) => (call[0] as { type: string }[])[0]?.type === 'checkbox'
    )
    expect(checkboxCall).toBeDefined()
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('ui.dev'), 'utf8'
    )
    expect(fs.appendFileSync).not.toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('api.dev'), 'utf8'
    )
  })

  test('warns about missing hosts entry when hosts permission is manual', async () => {
    const CONFIG_MANUAL_HOSTS = [
      'project: test',
      'domains:',
      '  - host: api.test.dev',
      '    target: http://127.0.0.1:3000',
      'permissions:',
      '  hosts: manual',
      '  docker: denied',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p).replace(/\\/g, '/').endsWith('.betty.yml')
    )
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('.betty.yml')) return CONFIG_MANUAL_HOSTS
      return ''
    })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('api.test.dev'))

    errorSpy.mockRestore()
  })

  test('uses confirm prompt for single-domain hosts:prompt and adds the entry', async () => {
    const CONFIG_SINGLE_PROMPT = [
      'project: test',
      'domains:',
      '  - host: api.test.dev',
      '    target: http://127.0.0.1:3000',
      'permissions:',
      '  hosts: prompt',
      '  docker: denied',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('.betty.yml')) return CONFIG_SINGLE_PROMPT
      return ''
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ ok: true } as never)

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)

    const confirmCall = (inquirer.prompt as unknown as jest.Mock).mock.calls.find(
      (call) => (call[0] as { type: string }[])[0]?.type === 'confirm'
    )
    expect(confirmCall).toBeDefined()
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('api.test.dev'), 'utf8'
    )
  })


  test('prompts user for docker permission and exits when denied interactively', async () => {
    const CONFIG_NO_HTTPS_PROMPT = [
      'project: test',
      'domains:',
      '  - host: test.localhost',
      '    target: http://127.0.0.1:3000',
      'permissions:',
      '  hosts: allowed',
      '  docker: prompt',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(CONFIG_NO_HTTPS_PROMPT)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue([])
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ ok: false } as never)
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
    expect(inquirer.prompt).toHaveBeenCalled()
  })

  test('creates certificate when cert files do not yet exist', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml' })

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('mkcert -cert-file'),
      expect.anything()
    )

    // On a fresh install the certs directory must exist before mkcert runs in it.
    const mkdirCall = (fs.mkdirSync as unknown as jest.Mock).mock.calls.findIndex((call) => String(call[0]).replace(/\\/g, '/').endsWith('/.betty/certs'))
    const mkcertCall = (execSync as unknown as jest.Mock).mock.calls.findIndex((call) => String(call[0]).includes('mkcert -cert-file'))
    expect(mkdirCall).toBeGreaterThanOrEqual(0)
    expect((fs.mkdirSync as unknown as jest.Mock).mock.invocationCallOrder[mkdirCall])
      .toBeLessThan((execSync as unknown as jest.Mock).mock.invocationCallOrder[mkcertCall])

    logSpy.mockRestore()
  })

  test('--yes skips all prompts by treating prompt permissions as allowed', async () => {
    const CONFIG_ALL_PROMPT = SAMPLE_CONFIG
      .replace('hosts: allowed', 'hosts: prompt')
      .replace('trustStore: allowed', 'trustStore: prompt')
      .replace('docker: allowed', 'docker: prompt')

    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return CONFIG_ALL_PROMPT
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml', yes: true })

    expect(inquirer.prompt).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('cleans up route and runs down command when up command is interrupted', async () => {
    const CONFIG_WITH_DOWN = SAMPLE_CONFIG + '\ndown:\n  command: docker compose down'
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return CONFIG_WITH_DOWN
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: 'SIGINT', status: null })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow('process-exit-0')
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mckanses-auth.yml'))
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('restart traefik'),
      expect.objectContaining({ stdio: 'pipe' })
    )
    // down.command is run via execSync (inside runProjectCommand)
    expect(execSync).toHaveBeenCalledWith('docker compose down', expect.objectContaining({
      cwd: expect.any(String),
    }))
  })

  test('holds the lock for linking and cleanup only, not for the up command or exit', async () => {
    const CONFIG_WITH_DOWN = SAMPLE_CONFIG + '\ndown:\n  command: docker compose down'
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return CONFIG_WITH_DOWN
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    const heldDuring: Record<string, boolean[]> = { proxyUp: [], restart: [], upCommand: [], down: [], exit: [] }
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes(' up -d')) heldDuring.proxyUp.push(lockState.held)
      if (command.includes('restart traefik')) heldDuring.restart.push(lockState.held)
      if (command === 'docker compose down') heldDuring.down.push(lockState.held)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    ;(spawnSync as unknown as jest.Mock).mockImplementation(() => {
      heldDuring.upCommand.push(lockState.held)
      return { signal: 'SIGINT', status: null }
    })
    ;(process.exit as unknown as jest.Mock).mockImplementation((code) => {
      heldDuring.exit.push(lockState.held)
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(devCommand({ config: '.betty.yml', yes: true })).rejects.toThrow('process-exit-0')

    expect(heldDuring).toEqual({ proxyUp: [true], restart: [true, true], upCommand: [false], down: [false], exit: [false] })
  })

  test('gives the targeted port hint when the proxy cannot bind its port', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      if (command.includes('up -d')) throw new Error('Bind for 0.0.0.0:80 failed: port is already allocated')
      return Buffer.from('')
    })

    const error = await devCommand({ config: '.betty.yml', yes: true }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(BettyError)
    expect((error as BettyError).hints.join(' ')).toContain('Port 80 is already in use')
    expect((error as BettyError).hints.join(' ')).toContain('betty project load')
  })

  const mockProjectEnv = (routeFileContent?: string): void => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG + '\ndown:\n  command: docker compose down'
      if (normalized.endsWith('/.betty/dynamic/mckanses-auth.yml')) {
        if (routeFileContent === undefined) throw new Error('ENOENT')
        return routeFileContent
      }
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  }

  test('treats an up command that exits with 130 (it trapped Ctrl+C) as an interrupt and cleans up', async () => {
    mockProjectEnv()
    ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: null, status: 130 })

    await expect(devCommand({ config: '.betty.yml', yes: true })).rejects.toThrow('process-exit-0')
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mckanses-auth.yml'))
    expect(execSync).toHaveBeenCalledWith('docker compose down', expect.anything())
  })

  test('keeps betty alive on Ctrl+C while the up command runs, and removes the listener afterwards', async () => {
    mockProjectEnv()
    const before = process.listenerCount('SIGINT')
    let during = -1
    ;(spawnSync as unknown as jest.Mock).mockImplementation(() => {
      during = process.listenerCount('SIGINT')
      return { signal: null, status: 0 }
    })

    await devCommand({ config: '.betty.yml', yes: true })

    expect(during).toBe(before + 1)
    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  test('refuses to overwrite a same-named project loaded from another .betty.yml', async () => {
    mockProjectEnv('# betty-project-config: /elsewhere/app/.betty.yml\nhttp: {}\n')

    await expect(devCommand({ config: '.betty.yml', yes: true })).rejects.toThrow("Project 'mckanses-auth' is already loaded from /elsewhere/app/.betty.yml.")
    expect(execSync).not.toHaveBeenCalledWith(expect.stringContaining('up -d'), expect.anything())
  })

  test('records the .betty.yml path in the project route file', async () => {
    mockProjectEnv()
    ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: null, status: 0 })

    await devCommand({ config: '.betty.yml', yes: true })

    const routeWrite = (fs.writeFileSync as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).replace(/\\/g, '/').endsWith('/.betty/dynamic/mckanses-auth.yml')
    )
    expect(String(routeWrite?.[1])).toMatch(/^# betty-project-config: .*\.betty\.yml\n/)
  })

  test('reloads a project from the same .betty.yml without a conflict', async () => {
    const configPath = path.resolve(process.cwd(), '.betty.yml')
    mockProjectEnv(`# betty-project-config: ${configPath}\nhttp: {}\n`)
    ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: null, status: 0 })

    await expect(devCommand({ config: '.betty.yml', yes: true })).resolves.toBeUndefined()
  })

  test('exits when a domain is already linked by another project', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem') ||
        normalized.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['other-project.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG
      if (normalized.endsWith('other-project.yml')) return [
        'http:',
        '  routers:',
        '    other-project-1:',
        '      rule: \'Host("ory-ui.mckansescloud.dev")\'',
        '      entryPoints: [web]',
        '      service: other-project-1',
      ].join('\n')
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
    // Rejected before any side effect: no prompt, hosts write, certificate or proxy start.
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(fs.appendFileSync).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalledWith(expect.stringMatching(/mkcert|up -d/), expect.anything())
  })

  test('dry-run does not log Up command when config has no up command', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p).replace(/\\/g, '/').endsWith('.betty.yml')
    )
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      'project: my-app\ndomains:\n  - host: my-app.localhost\n    target: http://127.0.0.1:3000\n'
    )
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml', dryRun: true })

    expect(logSpy).toHaveBeenCalledWith('Project: my-app')
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Up:'))

    logSpy.mockRestore()
  })

  test('prints URLs when no up command and linkProject succeeds', async () => {
    const CONFIG_NO_UP = [
      'project: test',
      'domains:',
      '  - host: test.localhost',
      '    target: http://127.0.0.1:3000',
      'permissions:',
      '  hosts: allowed',
      '  docker: allowed',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') || normalized.endsWith('/.betty/docker-compose.yml')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('.betty.yml')) return CONFIG_NO_UP
      return ''
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      return Buffer.from('')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await devCommand({ config: '.betty.yml' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Available URLs:'))

    logSpy.mockRestore()
  })

  test('exits when Docker is not running', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).replace(/\\/g, '/').endsWith('.betty.yml')) return 'project: test\ndomains:\n  - host: test.localhost\n    target: http://127.0.0.1:3000\npermissions:\n  hosts: allowed\n  docker: allowed\n'
      
      return ''
    })
    ;(execSync as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('Docker not available')
    })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
  })

  test('exits when up command exits with non-zero status code', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: null, status: 1 })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow(BettyError)
  })

  test('cleans up route without running down command when interrupted with no down config', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.endsWith('.betty.yml') ||
        normalized.endsWith('/.betty/docker-compose.yml') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev.pem') ||
        normalized.endsWith('/.betty/certs/ory-ui.mckansescloud.dev-key.pem') ||
        normalized.endsWith('/rootCA.pem')
    })
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const normalized = String(p).replace(/\\/g, '/')
      if (normalized.endsWith('.betty.yml')) return SAMPLE_CONFIG
      return '127.0.0.1 ory-ui.mckansescloud.dev # added by betty'
    })
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker ps')) return Buffer.from('betty-traefik\t0.0.0.0:443->443/tcp\n')
      if (command.includes('mkcert -CAROOT')) return Buffer.from('/ca')
      return Buffer.from('')
    })
    ;(spawnSync as unknown as jest.Mock).mockReturnValue({ signal: 'SIGINT', status: null })

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow('process-exit-0')
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mckanses-auth.yml'))
    const execCalls = (execSync as unknown as jest.Mock).mock.calls.map((c) => String(c[0]))
    expect(execCalls.some((c) => c.includes('compose down'))).toBe(false)
  })
})
