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
  const normalizePath = (value: string) => value.replace(/\\/g, '/')

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('prints JSON fallback when proxy is not set up', () => {
    (fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ json: true })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse((logSpy.mock.calls[0][0] as string))
    expect(payload.proxy.running).toBe(false)
    expect(payload.proxy.info).toBe('Could not determine proxy status.')
    expect(payload.projects).toEqual([])

    logSpy.mockRestore()
  })

  test('prints JSON with proxy and project details', () => {
    (fs.existsSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const inputPath = normalizePath(String(args[0]))
      return inputPath.endsWith('/.betty/docker-compose.yml') || inputPath.endsWith('/.betty/dynamic')
    });

    (fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml']);
    (fs.readFileSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const inputPath = normalizePath(String(args[0]))
      if (inputPath.endsWith('/.betty/dynamic/app.yml')) return [
          'http:',
          '  routers:',
          '    app:',
          '      rule: \'Host("app.localhost")\'',
          '  services:',
          '    app:',
          '      loadBalancer:',
          '        servers:',
          '          - url: http://172.18.0.2:5173',
          '',
        ].join('\n')
      
      return ''
    });

    (execSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const command = String(args[0])
      if (command === 'docker inspect betty-traefik') return Buffer.from('[{"State":{"Running":true,"StartedAt":"2026-05-02T00:00:00.000Z"}}]')
      
      if (command === 'docker ps --format {{.ID}}') return Buffer.from('abc123\n')
      
      if (command === 'docker inspect abc123') return Buffer.from('[{"NetworkSettings":{"Networks":{"betty_proxy":{"IPAddress":"172.18.0.2"}}},"State":{"Status":"running","StartedAt":"2026-05-02T00:00:00.000Z"},"RestartCount":1}]')
      
      throw new Error(`Unexpected command: ${command}`)
    })

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-02T01:00:00.000Z').getTime())
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ json: true })

    const payload = JSON.parse((logSpy.mock.calls[0][0] as string))
    expect(payload.proxy.running).toBe(true)
    expect(payload.projects).toHaveLength(1)
    expect(payload.projects[0].domain).toBe('app.localhost')
    expect(payload.projects[0].port).toBe('5173')
    expect(payload.projects[0].health).toBe('running')
    expect(payload.projects[0].restarts).toBe('1')

    nowSpy.mockRestore()
    logSpy.mockRestore()
  })

  test('prints short table when projects exist', () => {
    (fs.existsSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const inputPath = normalizePath(String(args[0]))
      return inputPath.endsWith('/.betty/docker-compose.yml') || inputPath.endsWith('/.betty/dynamic')
    });

    (fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml']);
    (fs.readFileSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const inputPath = normalizePath(String(args[0]))
      if (inputPath.endsWith('/.betty/dynamic/app.yml')) return [
          'http:',
          '  routers:',
          '    app:',
          '      rule: \'Host("app.localhost")\'',
          '  services:',
          '    app:',
          '      loadBalancer:',
          '        servers:',
          '          - url: http://172.18.0.2:5173',
          '',
        ].join('\n')
      
      return ''
    });

    (execSync as unknown as jest.Mock).mockImplementation((...args: unknown[]) => {
      const command = String(args[0])
      if (command === 'docker inspect betty-traefik') return Buffer.from('[{"State":{"Running":true,"StartedAt":"2026-05-02T00:00:00.000Z"}}]')
      
      if (command === 'docker ps --format {{.ID}}') return Buffer.from('abc123\n')
      
      if (command === 'docker inspect abc123') return Buffer.from('[{"NetworkSettings":{"Networks":{"betty_proxy":{"IPAddress":"172.18.0.2"}}},"State":{"Status":"running","StartedAt":"2026-05-02T00:00:00.000Z"},"RestartCount":1}]')
      
      throw new Error(`Unexpected command: ${command}`)
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusCommand({ short: true })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('project name')
    expect(output).toContain('domain')
    expect(output).toContain('target')
    expect(output).toContain('app.localhost')

    logSpy.mockRestore()
  })
})
