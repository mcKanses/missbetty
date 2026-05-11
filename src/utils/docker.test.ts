import { beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('child_process', () => ({ execSync: jest.fn() }))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

jest.mock('../cli/ui/output', () => ({
  printError: jest.fn(),
}))

jest.mock('./setup', () => ({
  checkMkcertInstalled: jest.fn(),
  isHttpsRequestedDomain: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_PROXY_COMPOSE: '/home/test/.betty/docker-compose.yml',
  BETTY_CERTS_DIR: '/home/test/.betty/certs',
  BETTY_PROXY_NETWORK: 'betty_proxy',
}))

jest.mock('./names', () => ({
  sanitizeName: jest.fn((name: string) => name),
}))

import fs from 'fs'
import { execSync } from 'child_process'
import { printError } from '../cli/ui/output'
import { checkMkcertInstalled, isHttpsRequestedDomain } from './setup'
import { sanitizeName } from './names'
import {
  resolveTraefikComposePath,
  getRunningContainers,
  connectContainerToNetwork,
  getContainerIp,
  restartTraefik,
  ensureCertificate,
} from './docker'

const CERTS_DIR = '/home/test/.betty/certs'

const makeInspect = (networks: string[], ip = '172.20.0.2'): string =>
  JSON.stringify([{
    NetworkSettings: {
      Networks: Object.fromEntries(networks.map((n) => [n, { IPAddress: ip }])),
    },
  }])

beforeEach(() => {
  jest.resetAllMocks()
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
  ;(sanitizeName as unknown as jest.Mock).mockImplementation((name: unknown) => name)
})

describe('resolveTraefikComposePath', () => {
  it('returns the compose path when the file exists', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)

    expect(resolveTraefikComposePath()).toBe('/home/test/.betty/docker-compose.yml')
  })

  it('exits when the compose file does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(() => { resolveTraefikComposePath() }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalled()
  })
})

describe('getRunningContainers', () => {
  it('returns a list of running container names', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue('nginx-1\ntraefik-1')

    expect(getRunningContainers()).toEqual(['nginx-1', 'traefik-1'])
  })

  it('returns empty array when no containers are running', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue('')

    expect(getRunningContainers()).toEqual([])
  })

  it('returns empty array when docker command fails', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('docker not found') })

    expect(getRunningContainers()).toEqual([])
  })
})

describe('connectContainerToNetwork', () => {
  it('does nothing when container is already in the betty network', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(makeInspect(['betty_proxy', 'bridge']))

    connectContainerToNetwork('myapp-1')

    expect(execSync).toHaveBeenCalledTimes(1)
  })

  it('connects the container when it is not yet in the betty network', () => {
    ;(execSync as unknown as jest.Mock)
      .mockReturnValueOnce(makeInspect(['bridge']))
      .mockReturnValueOnce(undefined)

    connectContainerToNetwork('myapp-1')

    expect(execSync).toHaveBeenCalledTimes(2)
    expect(execSync).toHaveBeenLastCalledWith(expect.stringContaining('network connect'), expect.anything())
  })

  it('exits when the container is not found', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('No such container') })

    expect(() => { connectContainerToNetwork('myapp-1') }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalledWith(expect.stringContaining('myapp-1'))
  })

  it('exits when network connect fails', () => {
    ;(execSync as unknown as jest.Mock)
      .mockReturnValueOnce(makeInspect(['bridge']))
      .mockImplementationOnce(() => { throw new Error('network error') })

    expect(() => { connectContainerToNetwork('myapp-1') }).toThrow('process-exit-1')
  })
})

describe('getContainerIp', () => {
  it('returns the container IP from the betty network', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(makeInspect(['betty_proxy'], '172.20.0.5'))

    expect(getContainerIp('myapp-1')).toBe('172.20.0.5')
  })

  it('exits when the container is not found', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('No such container') })

    expect(() => { getContainerIp('myapp-1') }).toThrow('process-exit-1')
  })

  it('exits when the container has no IP in the betty network', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(makeInspect(['betty_proxy'], ''))

    expect(() => { getContainerIp('myapp-1') }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalledWith(expect.stringContaining('IP'))
  })
})

describe('restartTraefik', () => {
  it('runs docker compose restart traefik', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    restartTraefik('/home/test/.betty/docker-compose.yml')

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('restart traefik'),
      expect.anything()
    )
  })

  it('exits when restart fails', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('restart failed') })

    expect(() => { restartTraefik('/home/test/.betty/docker-compose.yml') }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalledWith(expect.stringContaining('Traefik'))
  })
})

describe('ensureCertificate', () => {
  beforeEach(() => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(false)
  })

  it('returns cert paths when cert files already exist', () => {
    const result = ensureCertificate('myapp.dev')

    expect(result).toEqual({
      certFile: '/certs/myapp.dev.pem',
      keyFile: '/certs/myapp.dev-key.pem',
    })
    expect(execSync).not.toHaveBeenCalled()
  })

  it('creates certs dir when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    ensureCertificate('myapp.dev')

    expect(fs.mkdirSync).toHaveBeenCalledWith(CERTS_DIR, { recursive: true })
  })

  it('generates a certificate when cert files do not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    const result = ensureCertificate('myapp.dev')

    expect(result).toEqual({
      certFile: '/certs/myapp.dev.pem',
      keyFile: '/certs/myapp.dev-key.pem',
    })
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('mkcert'), expect.anything())
  })

  it('returns null when mkcert is not installed and domain does not require https', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(false)

    expect(ensureCertificate('myapp.localhost')).toBeNull()
  })

  it('exits when mkcert is not installed but domain requires https', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(true)

    expect(() => { ensureCertificate('myapp.dev') }).toThrow('process-exit-1')
  })

  it('returns null when cert creation fails and domain does not require https', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('mkcert failed') })
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(false)

    expect(ensureCertificate('myapp.dev')).toBeNull()
  })

  it('exits when cert creation fails and domain requires https', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('mkcert failed') })
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(true)

    expect(() => { ensureCertificate('myapp.dev') }).toThrow('process-exit-1')
  })
})
