import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import statusCommand from './status'

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

describe('status command', () => {
  const normalizePath = (value: string): string => value.replace(/\\/g, '/')

  const mockRunningProxy = (): void => {
    ;(execSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const command = String(args[0])
      if (command.includes('docker inspect betty-traefik')) return Buffer.from('[{"State":{"Running":true,"StartedAt":"2026-05-02T00:00:00.000Z"}}]')
      if (command === 'docker ps --format {{.ID}}') return Buffer.from('abc123\n')
      if (command === 'docker inspect abc123') return Buffer.from('[{"NetworkSettings":{"Networks":{"betty_proxy":{"IPAddress":"172.18.0.2"}}},"State":{"Status":"running","StartedAt":"2026-05-02T00:00:00.000Z"},"RestartCount":1}]')
      throw new Error(`Unexpected command: ${command}`)
    })
  }

  const mockRouteFile = (url: string): void => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const p = normalizePath(String(args[0]))
      return p.endsWith('/.betty/docker-compose.yml') || p.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const p = normalizePath(String(args[0]))
      if (p.endsWith('/.betty/dynamic/app.yml')) return [
          'http:',
          '  routers:',
          '    app:',
          '      rule: \'Host("app.localhost")\'',
          '  services:',
          '    app:',
          '      loadBalancer:',
          '        servers:',
          `          - url: ${url}`,
          '',
        ].join('\n')
      return ''
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns empty project list and proxy-down state when Betty is not set up', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ json: true })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as { proxy: { running: boolean; info: string }; projects: unknown[] }
    expect(payload.proxy.running).toBe(false)
    expect(payload.proxy.info).toBe('Could not determine proxy status.')
    expect(payload.projects).toEqual([])

    logSpy.mockRestore()
  })

  test('returns proxy details and project list as JSON', () => {
    mockRouteFile('http://172.18.0.2:5173')
    mockRunningProxy()

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-02T01:00:00.000Z').getTime())
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ json: true })

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      proxy: { running: boolean };
      projects: { domain: string; port: string; health: string; restarts: string }[];
    }
    expect(payload.proxy.running).toBe(true)
    expect(payload.projects).toHaveLength(1)
    expect(payload.projects[0].domain).toBe('http://app.localhost')
    expect(payload.projects[0].port).toBe('5173')
    expect(payload.projects[0].health).toBe('running')
    expect(payload.projects[0].restarts).toBe('1')

    nowSpy.mockRestore()
    logSpy.mockRestore()
  })

  test('renders short table with domain, target, and project name columns', () => {
    mockRouteFile('http://172.18.0.2:5173')
    mockRunningProxy()

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ short: true })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('project name')
    expect(output).toContain('domain')
    expect(output).toContain('target')
    expect(output).toContain('app.localhost')

    logSpy.mockRestore()
  })

  test('renders http:// prefix for non-HTTPS routes in short table', () => {
    mockRouteFile('http://172.18.0.2:5173')
    mockRunningProxy()

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ short: true })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('http://app.localhost')

    logSpy.mockRestore()
  })

  test('renders https:// prefix for HTTPS routes in short table', () => {
    mockRouteFile('https://172.18.0.2:443')
    mockRunningProxy()

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ short: true })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('https://app.localhost')

    logSpy.mockRestore()
  })

  test('renders full table with uptime, health and restarts columns', () => {
    mockRouteFile('http://172.18.0.2:5173')
    mockRunningProxy()

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('uptime')
    expect(output).toContain('health')
    expect(output).toContain('restarts')
    expect(output).toContain('app.localhost')

    logSpy.mockRestore()
  })

  test('prints Traefik container details with --long flag', () => {
    mockRouteFile('http://172.18.0.2:5173')
    mockRunningProxy()

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ long: true })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Traefik Container Details')

    logSpy.mockRestore()
  })

  test('shows n/a metadata when no container has the linked IP', () => {
    mockRouteFile('http://172.18.0.2:5173')
    ;(execSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const command = String(args[0])
      if (command.includes('docker inspect betty-traefik')) return Buffer.from('[{"State":{"Running":true,"StartedAt":"2026-05-02T00:00:00.000Z"}}]')
      if (command === 'docker ps --format {{.ID}}') return Buffer.from('abc123\n')
      if (command === 'docker inspect abc123') return Buffer.from('[{"NetworkSettings":{"Networks":{"betty_proxy":{"IPAddress":"10.0.0.99"}}},"State":{"Status":"running","StartedAt":"2026-05-02T00:00:00.000Z"},"RestartCount":0}]')
      throw new Error(`Unexpected command: ${command}`)
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ json: true })

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      projects: { uptime: string; health: string; restarts: string }[];
    }
    expect(payload.projects[0].uptime).toBe('n/a')
    expect(payload.projects[0].health).toBe('n/a')
    expect(payload.projects[0].restarts).toBe('n/a')

    logSpy.mockRestore()
  })

  test('prints proxy info and "No links found" when no routes exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const p = normalizePath(String(args[0]))
      return p.endsWith('/.betty/docker-compose.yml') || p.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue([])
    ;(execSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const command = String(args[0])
      if (command.includes('docker inspect betty-traefik')) return Buffer.from('[{"State":{"Running":true,"StartedAt":"2026-05-02T00:00:00.000Z"}}]')
      throw new Error(`Unexpected command: ${command}`)
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('No links found')

    logSpy.mockRestore()
  })

  test('skips malformed dynamic config files and returns empty project list', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const p = normalizePath(String(args[0]))
      return p.endsWith('/.betty/docker-compose.yml') || p.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['bad.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('ENOENT') })
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('docker not found') })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ json: true })

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as { projects: unknown[] }
    expect(payload.projects).toEqual([])

    logSpy.mockRestore()
  })
})
