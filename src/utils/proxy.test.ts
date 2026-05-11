import { beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('child_process', () => ({ execSync: jest.fn() }))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

jest.mock('../cli/ui/output', () => ({
  printError: jest.fn(),
  printHint: jest.fn(),
}))

jest.mock('./portOwners', () => ({
  getDockerPortOwners: jest.fn(),
  getSystemPortOwners: jest.fn(),
  filterSystemOwnersForBettyPort: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_TRAEFIK_CONTAINER: 'betty-traefik',
  BETTY_HOME_DIR: '/home/test-user/.betty',
  BETTY_DYNAMIC_DIR: '/home/test-user/.betty/dynamic',
  BETTY_CERTS_DIR: '/home/test-user/.betty/certs',
  BETTY_PROXY_COMPOSE: '/home/test-user/.betty/docker-compose.yml',
  BETTY_PROXY_NETWORK: 'betty_proxy',
  TRAEFIK_COMPOSE: 'traefik-compose-content',
}))

import fs from 'fs'
import { execSync } from 'child_process'
import { printError, printHint } from '../cli/ui/output'
import { getDockerPortOwners, getSystemPortOwners, filterSystemOwnersForBettyPort } from './portOwners'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, printProxyStartError } from './proxy'

beforeEach(() => {
  jest.resetAllMocks()
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
  ;(getSystemPortOwners as unknown as jest.Mock).mockReturnValue([])
  ;(filterSystemOwnersForBettyPort as unknown as jest.Mock).mockReturnValue([])
})

describe('ensureHttpsPortAvailable', () => {
  it('does nothing when betty exclusively owns port 443', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue(['betty-traefik-1'])

    expect(() => { ensureHttpsPortAvailable() }).not.toThrow()
    expect(printError).not.toHaveBeenCalled()
  })

  it('does nothing when port 443 is completely free', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue([])

    expect(() => { ensureHttpsPortAvailable() }).not.toThrow()
    expect(printError).not.toHaveBeenCalled()
  })

  it('exits when another docker container occupies port 443', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue(['nginx-proxy-1'])

    expect(() => { ensureHttpsPortAvailable() }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalledWith('Port 443 is already in use.')
  })

  it('exits when a system process occupies port 443', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue([])
    ;(filterSystemOwnersForBettyPort as unknown as jest.Mock).mockReturnValue(['nginx (pid 1234)'])

    expect(() => { ensureHttpsPortAvailable() }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalledWith('Port 443 is already in use.')
  })

  it('lists conflicting docker containers in output', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue(['nginx-1', 'apache-1'])

    expect(() => { ensureHttpsPortAvailable() }).toThrow()
    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('nginx-1'))
    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('apache-1'))
  })

  it('lists conflicting system processes in output', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue([])
    ;(filterSystemOwnersForBettyPort as unknown as jest.Mock).mockReturnValue(['caddy (pid 999)'])

    expect(() => { ensureHttpsPortAvailable() }).toThrow()
    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('caddy (pid 999)'))
  })
})

describe('ensureProxySetup', () => {
  beforeEach(() => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('traefik-compose-content')
  })

  it('does nothing when all dirs and compose file already exist and are current', () => {
    ensureProxySetup()

    expect(fs.mkdirSync).not.toHaveBeenCalled()
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('creates home dir when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) !== '/home/test-user/.betty'
    )

    ensureProxySetup()

    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test-user/.betty', { recursive: true })
  })

  it('creates dynamic dir when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) !== '/home/test-user/.betty/dynamic'
    )

    ensureProxySetup()

    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test-user/.betty/dynamic', { recursive: true })
  })

  it('creates certs dir only when opts.certs is true', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')

    ensureProxySetup()
    expect(fs.mkdirSync).not.toHaveBeenCalledWith('/home/test-user/.betty/certs', expect.anything())

    jest.clearAllMocks()
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')

    ensureProxySetup({ certs: true })
    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test-user/.betty/certs', { recursive: true })
  })

  it('writes compose file when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) !== '/home/test-user/.betty/docker-compose.yml'
    )

    ensureProxySetup()

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/home/test-user/.betty/docker-compose.yml',
      'traefik-compose-content',
      'utf8'
    )
  })

  it('updates compose file when content is outdated', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('old-content')

    ensureProxySetup()

    expect(fs.writeFileSync).toHaveBeenCalled()
  })
})

describe('ensureProxyNetwork', () => {
  it('does nothing when network already exists', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => undefined)

    ensureProxyNetwork()

    expect(execSync).toHaveBeenCalledTimes(1)
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('inspect'), expect.anything())
  })

  it('creates network when it does not exist', () => {
    ;(execSync as unknown as jest.Mock)
      .mockImplementationOnce(() => { throw new Error('not found') })
      .mockImplementationOnce(() => undefined)

    ensureProxyNetwork()

    expect(execSync).toHaveBeenCalledTimes(2)
    expect(execSync).toHaveBeenLastCalledWith(expect.stringContaining('create'), expect.anything())
  })
})

describe('printProxyStartError', () => {
  it('prints generic error with the raw message as fallback', () => {
    printProxyStartError('some unknown error', 'serve')

    expect(printError).toHaveBeenCalledWith("Betty's proxy could not be started.")
    expect(printHint).toHaveBeenCalledWith('some unknown error')
  })

  it('handles docker.sock permission denied with correct command', () => {
    printProxyStartError('permission denied while connecting to /var/run/docker.sock', 'serve')

    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('newgrp docker'))
    expect(printHint).toHaveBeenCalledWith('Then run: betty serve')
  })

  it('handles port 80 conflict with the given command name', () => {
    printProxyStartError('Bind for 0.0.0.0:80 failed: port is already allocated', 'link')

    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('betty link'))
  })

  it('handles port 443 conflict', () => {
    printProxyStartError('Bind for 0.0.0.0:443 failed: port is already allocated', 'serve')

    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('betty serve'))
    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('docker ps'))
  })

  it('handles "port is already allocated" message for 443', () => {
    printProxyStartError('port is already allocated', 'serve')

    expect(printHint).toHaveBeenCalledWith(expect.stringContaining('betty serve'))
  })
})
