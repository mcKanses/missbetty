import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import linkCommand from './link'

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
  jest.clearAllMocks()
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

