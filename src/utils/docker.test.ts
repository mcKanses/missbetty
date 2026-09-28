import { beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('child_process', () => ({ execFileSync: jest.fn() }))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

jest.mock('./setup', () => ({
  checkMkcertInstalled: jest.fn(),
  checkMkcertCaInstalled: jest.fn(),
  isHttpsRequestedDomain: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_PROXY_COMPOSE: '/home/test/.betty/docker-compose.yml',
  BETTY_CERTS_DIR: '/home/test/.betty/certs',
  BETTY_PROXY_NETWORK: 'betty_proxy',
}))

jest.mock('./names', () => ({
  sanitizeName: jest.fn((name: string) => name),
  certificatePaths: (domain: string) => ({
    hostPath: `/home/test/.betty/certs/${domain}.pem`,
    keyPath: `/home/test/.betty/certs/${domain}-key.pem`,
    certFile: `/certs/${domain}.pem`,
    keyFile: `/certs/${domain}-key.pem`,
  }),
}))

import fs from 'fs'
import { execFileSync } from 'child_process'
import { BettyError } from './errors'
import { checkMkcertCaInstalled, checkMkcertInstalled, isHttpsRequestedDomain } from './setup'
import { sanitizeName } from './names'
import {
  resolveTraefikComposePath,
  getRunningContainers,
  connectContainerToNetwork,
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

    expect(() => { resolveTraefikComposePath() }).toThrow(BettyError)
    expect(() => { resolveTraefikComposePath() }).toThrow("Betty's proxy is not set up")
  })
})

describe('getRunningContainers', () => {
  it('returns a list of running container names', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue('nginx-1\ntraefik-1')

    expect(getRunningContainers()).toEqual(['nginx-1', 'traefik-1'])
  })

  it('returns empty array when no containers are running', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue('')

    expect(getRunningContainers()).toEqual([])
  })

  it('returns empty array when docker command fails', () => {
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('docker not found') })

    expect(getRunningContainers()).toEqual([])
  })

  it('trims CRLF line endings from Windows docker output', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue('nginx-1\r\ntraefik-1\r\n')

    expect(getRunningContainers()).toEqual(['nginx-1', 'traefik-1'])
  })
})

describe('connectContainerToNetwork', () => {
  it('does nothing when container is already in the betty network', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(makeInspect(['betty_proxy', 'bridge']))

    connectContainerToNetwork('myapp-1')

    expect(execFileSync).toHaveBeenCalledTimes(1)
  })

  it('connects the container when it is not yet in the betty network', () => {
    ;(execFileSync as unknown as jest.Mock)
      .mockReturnValueOnce(makeInspect(['bridge']))
      .mockReturnValueOnce(undefined)

    connectContainerToNetwork('myapp-1')

    expect(execFileSync).toHaveBeenCalledTimes(2)
    expect(execFileSync).toHaveBeenLastCalledWith('docker', expect.arrayContaining(['network', 'connect']), expect.anything())
  })

  it('exits when the container is not found', () => {
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('No such container') })

    expect(() => { connectContainerToNetwork('myapp-1') }).toThrow("Container 'myapp-1' not found")
  })

  it('returns the canonical container name when linked by ID prefix', () => {
    ;(execFileSync as unknown as jest.Mock)
      .mockReturnValueOnce(JSON.stringify([{ Name: '/shop-web-1', State: { Running: true }, NetworkSettings: { Networks: { bridge: {} } } }]))
      .mockReturnValueOnce(undefined)

    expect(connectContainerToNetwork('3f2a')).toBe('shop-web-1')
    expect(execFileSync).toHaveBeenLastCalledWith('docker', ['network', 'connect', 'betty_proxy', 'shop-web-1'], expect.anything())
  })

  it('falls back to the given reference when inspect reports no name', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(makeInspect(['betty_proxy']))

    expect(connectContainerToNetwork('myapp-1')).toBe('myapp-1')
  })

  it('refuses a stopped container instead of linking an unreachable target', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify([{ Name: '/myapp-1', State: { Running: false }, NetworkSettings: { Networks: { bridge: {} } } }]))

    expect(() => { connectContainerToNetwork('myapp-1') }).toThrow("Container 'myapp-1' is not running.")
    expect(execFileSync).toHaveBeenCalledTimes(1)
  })

  it('inspects containers only, so an image with the same name is not mistaken for one', () => {
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('Error: No such container: nginx') })

    expect(() => { connectContainerToNetwork('nginx') }).toThrow("Container 'nginx' not found")
    expect(execFileSync).toHaveBeenCalledWith('docker', ['inspect', '--type', 'container', 'nginx'], expect.anything())
  })

  it('exits when inspect returns no container', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue('[]')

    expect(() => { connectContainerToNetwork('myapp-1') }).toThrow("Container 'myapp-1' not found")
  })

  it('exits when network connect fails', () => {
    ;(execFileSync as unknown as jest.Mock)
      .mockReturnValueOnce(makeInspect(['bridge']))
      .mockImplementationOnce(() => { throw new Error('network error') })

    expect(() => { connectContainerToNetwork('myapp-1') }).toThrow('Failed to connect')
  })
})

describe('restartTraefik', () => {
  it('runs docker compose restart traefik', () => {
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(undefined)

    restartTraefik('/home/test/.betty/docker-compose.yml')

    expect(execFileSync).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['restart', 'traefik']),
      expect.anything()
    )
  })

  it('exits when restart fails', () => {
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('restart failed') })

    expect(() => { restartTraefik('/home/test/.betty/docker-compose.yml') }).toThrow('Failed to restart Traefik')
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
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('creates certs dir when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(undefined)

    ensureCertificate('myapp.dev')

    expect(fs.mkdirSync).toHaveBeenCalledWith(CERTS_DIR, { recursive: true })
  })

  it('generates a certificate when cert files do not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(undefined)

    const result = ensureCertificate('myapp.dev')

    expect(result).toEqual({
      certFile: '/certs/myapp.dev.pem',
      keyFile: '/certs/myapp.dev-key.pem',
    })
    expect(execFileSync).toHaveBeenCalledWith('mkcert', expect.arrayContaining(['-cert-file']), expect.anything())
  })

  it('runs mkcert -install only when the local CA is missing', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => String(p) === CERTS_DIR)
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(undefined)

    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)
    ensureCertificate('myapp.dev')
    expect(execFileSync).not.toHaveBeenCalledWith('mkcert', ['-install'], expect.anything())

    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ensureCertificate('myapp.dev')
    expect(execFileSync).toHaveBeenCalledWith('mkcert', ['-install'], expect.anything())
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

    expect(() => { ensureCertificate('myapp.dev') }).toThrow('mkcert is not installed')
  })

  it('returns null when cert creation fails and domain does not require https', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('mkcert failed') })
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(false)

    expect(ensureCertificate('myapp.dev')).toBeNull()
  })

  it('exits when cert creation fails and domain requires https', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p) === CERTS_DIR
    )
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('mkcert failed') })
    ;(isHttpsRequestedDomain as unknown as jest.Mock).mockReturnValue(true)

    expect(() => { ensureCertificate('myapp.dev') }).toThrow('certificate creation failed')
  })
})
