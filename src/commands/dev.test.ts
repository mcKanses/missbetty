import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import devCommand, { readDevProjectConfig } from './dev'

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
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  },
  existsSync: jest.fn(),
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
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
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
    expect(execSync).toHaveBeenCalledWith('docker compose up -d', expect.objectContaining({
      cwd: expect.any(String),
    }))

    logSpy.mockRestore()
  })

  test('fails when prompt permission is denied', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(SAMPLE_CONFIG.replace('docker: allowed', 'docker: prompt'))
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ ok: false } as never)
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow('process-exit-1')
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

    await expect(devCommand({ dryRun: true })).rejects.toThrow('process-exit-1')
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

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow('process-exit-1')
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

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow('process-exit-1')
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
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ ok: false } as never)
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(devCommand({ config: '.betty.yml' })).rejects.toThrow('process-exit-1')
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

    logSpy.mockRestore()
  })
})
