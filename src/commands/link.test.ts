import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import linkCommand, { suggestDomain } from './link'

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

  test('exits with 1 when invalid port is given', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(execSync as unknown as jest.Mock).mockReturnValue(Buffer.from(''))

    await expect(linkCommand('myapp', { domain: 'myapp.localhost', port: 'abc' })).rejects.toThrow(
      'process-exit-1'
    )
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

