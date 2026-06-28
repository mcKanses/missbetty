import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import fs from 'fs'
import { getDomainSuffix, getStoredDomainSuffix, setDomainSuffix, getHttpPort, getHttpsPort } from './config'

jest.mock('./constants', () => ({
  BETTY_HOME_DIR: '/home/test-user/.betty',
  BETTY_CONFIG_PATH: '/home/test-user/.betty/config.json',
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}))

const originalEnv = process.env.BETTY_DOMAIN_SUFFIX

const originalHttpPortEnv = process.env.BETTY_HTTP_PORT
const originalHttpsPortEnv = process.env.BETTY_HTTPS_PORT

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.BETTY_DOMAIN_SUFFIX
  delete process.env.BETTY_HTTP_PORT
  delete process.env.BETTY_HTTPS_PORT
})

afterAll(() => {
  if (originalEnv === undefined) delete process.env.BETTY_DOMAIN_SUFFIX
  else process.env.BETTY_DOMAIN_SUFFIX = originalEnv
  if (originalHttpPortEnv === undefined) delete process.env.BETTY_HTTP_PORT
  else process.env.BETTY_HTTP_PORT = originalHttpPortEnv
  if (originalHttpsPortEnv === undefined) delete process.env.BETTY_HTTPS_PORT
  else process.env.BETTY_HTTPS_PORT = originalHttpsPortEnv
})

describe('getDomainSuffix', () => {
  test('returns .dev when no env var and no config file', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(getDomainSuffix()).toBe('.dev')
  })

  test('returns env var value when BETTY_DOMAIN_SUFFIX is set', () => {
    process.env.BETTY_DOMAIN_SUFFIX = '.localhost'
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(getDomainSuffix()).toBe('.localhost')
  })

  test('normalizes env var by prepending dot if missing', () => {
    process.env.BETTY_DOMAIN_SUFFIX = 'localhost'
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(getDomainSuffix()).toBe('.localhost')
  })

  test('returns configured suffix from config file when env var is absent', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ domainSuffix: '.test' }))

    expect(getDomainSuffix()).toBe('.test')
  })

  test('falls back to .dev when config file contains invalid suffix', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ domainSuffix: 'not valid!' }))

    expect(getDomainSuffix()).toBe('.dev')
  })

  test('falls back to .dev when config file is malformed JSON', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('{ broken json')

    expect(getDomainSuffix()).toBe('.dev')
  })

  test('env var takes precedence over config file', () => {
    process.env.BETTY_DOMAIN_SUFFIX = '.env-wins'
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ domainSuffix: '.from-file' }))

    expect(getDomainSuffix()).toBe('.env-wins')
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })
})

describe('setDomainSuffix', () => {
  test('writes normalized suffix and returns it', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('{}')

    const result = setDomainSuffix('.staging')

    expect(result).toBe('.staging')
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/home/test-user/.betty/config.json',
      expect.stringContaining('.staging'),
      'utf8'
    )
  })

  test('prepends dot when writing suffix without one', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('{}')

    const result = setDomainSuffix('staging')

    expect(result).toBe('.staging')
  })

  test('throws on invalid suffix', () => {
    expect(() => { setDomainSuffix('not valid!') }).toThrow('Invalid domain suffix')
  })

  test('creates home dir if it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) =>
      String(p).endsWith('config.json')
    )
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('{}')

    setDomainSuffix('.dev')

    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test-user/.betty', { recursive: true })
  })
})

describe('getHttpPort / getHttpsPort', () => {
  test('default to 80 and 443 when no env var and no config file', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(getHttpPort()).toBe(80)
    expect(getHttpsPort()).toBe(443)
  })

  test('read ports from the config file', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ httpPort: 8080, httpsPort: 8443 }))

    expect(getHttpPort()).toBe(8080)
    expect(getHttpsPort()).toBe(8443)
  })

  test('env vars take precedence over the config file', () => {
    process.env.BETTY_HTTP_PORT = '9080'
    process.env.BETTY_HTTPS_PORT = '9443'
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ httpPort: 8080, httpsPort: 8443 }))

    expect(getHttpPort()).toBe(9080)
    expect(getHttpsPort()).toBe(9443)
  })

  test('fall back to defaults when env var is not a valid port', () => {
    process.env.BETTY_HTTP_PORT = 'not-a-port'
    process.env.BETTY_HTTPS_PORT = '70000'
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(getHttpPort()).toBe(80)
    expect(getHttpsPort()).toBe(443)
  })

  test('fall back to defaults when config holds an out-of-range port', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ httpPort: 0, httpsPort: 99999 }))

    expect(getHttpPort()).toBe(80)
    expect(getHttpsPort()).toBe(443)
  })
})

describe('getStoredDomainSuffix', () => {
  test('returns null when no config file exists', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    expect(getStoredDomainSuffix()).toBeNull()
  })

  test('returns stored suffix from config file', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ domainSuffix: '.custom' }))

    expect(getStoredDomainSuffix()).toBe('.custom')
  })

  test('returns null when stored suffix is invalid', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ domainSuffix: 'bad!' }))

    expect(getStoredDomainSuffix()).toBeNull()
  })
})
