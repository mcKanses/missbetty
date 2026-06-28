import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import configCommand from './config'
import {
  getDomainSuffix,
  getStoredDomainSuffix,
  setDomainSuffix,
  getHttpPort,
  getHttpsPort,
  setHttpPort,
  setHttpsPort,
} from '../utils/config'
import { BettyError } from '../utils/errors'

jest.mock('../utils/config', () => ({
  __esModule: true,
  getDomainSuffix: jest.fn(),
  getStoredDomainSuffix: jest.fn(),
  setDomainSuffix: jest.fn(),
  getHttpPort: jest.fn(),
  getHttpsPort: jest.fn(),
  setHttpPort: jest.fn(),
  setHttpsPort: jest.fn(),
}))

describe('config command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.BETTY_DOMAIN_SUFFIX
    ;(getHttpPort as unknown as jest.Mock).mockReturnValue(80)
    ;(getHttpsPort as unknown as jest.Mock).mockReturnValue(443)
    ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })
  })

  test('prints config for no action', () => {
    ;(getDomainSuffix as unknown as jest.Mock).mockReturnValue('.dev')
    ;(getStoredDomainSuffix as unknown as jest.Mock).mockReturnValue(null)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand(undefined)

    expect(logSpy).toHaveBeenCalledWith('Betty config:')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.dev'))
    logSpy.mockRestore()
  })

  test('prints config for list action', () => {
    ;(getDomainSuffix as unknown as jest.Mock).mockReturnValue('.localhost')
    ;(getStoredDomainSuffix as unknown as jest.Mock).mockReturnValue('.localhost')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('list')

    expect(logSpy).toHaveBeenCalledWith('Betty config:')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.localhost'))
    logSpy.mockRestore()
  })

  test('shows env source when BETTY_DOMAIN_SUFFIX is set', () => {
    process.env.BETTY_DOMAIN_SUFFIX = '.test'
    ;(getDomainSuffix as unknown as jest.Mock).mockReturnValue('.test')
    ;(getStoredDomainSuffix as unknown as jest.Mock).mockReturnValue(null)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('list')

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('BETTY_DOMAIN_SUFFIX'))
    logSpy.mockRestore()
  })

  test('prints configured domain suffix for get command', () => {
    ;(getDomainSuffix as unknown as jest.Mock).mockReturnValue('.dev')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('get', 'domainSuffix')

    expect(logSpy).toHaveBeenCalledWith('.dev')
    logSpy.mockRestore()
  })

  test('sets domain suffix for set command', () => {
    ;(setDomainSuffix as unknown as jest.Mock).mockReturnValue('.localhost')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('set', 'domainSuffix', '.localhost')

    expect(setDomainSuffix).toHaveBeenCalledWith('.localhost')
    expect(logSpy).toHaveBeenCalledWith('Saved: domainSuffix=.localhost')
    logSpy.mockRestore()
  })

  test('throws a BettyError for an unknown get key', () => {
    expect(() => { configCommand('get', 'other') }).toThrow(BettyError)
    expect(() => { configCommand('get', 'other') }).toThrow('Unknown config key. Supported: domainSuffix')
  })

  test('throws when set is given an unknown key', () => {
    expect(() => { configCommand('set', 'other', '.localhost') }).toThrow('Unknown config key. Supported: domainSuffix')
    expect(setDomainSuffix).not.toHaveBeenCalled()
  })

  test('throws when set is missing a value', () => {
    expect(() => { configCommand('set', 'domainSuffix') }).toThrow('Missing value')
    expect(setDomainSuffix).not.toHaveBeenCalled()
  })

  test('throws when set value is only whitespace', () => {
    expect(() => { configCommand('set', 'domainSuffix', '   ') }).toThrow('Missing value')
    expect(setDomainSuffix).not.toHaveBeenCalled()
  })

  test('wraps the error when setDomainSuffix throws', () => {
    ;(setDomainSuffix as unknown as jest.Mock).mockImplementation(() => { throw new Error('disk full') })

    expect(() => { configCommand('set', 'domainSuffix', '.localhost') }).toThrow('disk full')
  })

  test('stringifies a non-Error thrown by setDomainSuffix', () => {
    ;(setDomainSuffix as unknown as jest.Mock).mockImplementation(() => {
      const failure: unknown = 'plain string failure'
      throw failure
    })

    expect(() => { configCommand('set', 'domainSuffix', '.localhost') }).toThrow('plain string failure')
  })

  test('throws for an unrecognized action', () => {
    expect(() => { configCommand('bogus') }).toThrow('Usage: betty config [get|set] <key> [value]')
  })

  test('list shows the configured http and https ports', () => {
    ;(getDomainSuffix as unknown as jest.Mock).mockReturnValue('.dev')
    ;(getStoredDomainSuffix as unknown as jest.Mock).mockReturnValue(null)
    ;(getHttpPort as unknown as jest.Mock).mockReturnValue(8080)
    ;(getHttpsPort as unknown as jest.Mock).mockReturnValue(8443)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('list')

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('httpPort'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('8080'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('8443'))
    logSpy.mockRestore()
  })

  test('get returns the configured http port', () => {
    ;(getHttpPort as unknown as jest.Mock).mockReturnValue(8080)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('get', 'httpPort')

    expect(logSpy).toHaveBeenCalledWith('8080')
    logSpy.mockRestore()
  })

  test('set saves the https port', () => {
    ;(setHttpsPort as unknown as jest.Mock).mockReturnValue(8443)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    configCommand('set', 'httpsPort', '8443')

    expect(setHttpsPort).toHaveBeenCalledWith('8443')
    expect(logSpy).toHaveBeenCalledWith('Saved: httpsPort=8443')
    logSpy.mockRestore()
  })

  test('set rejects an invalid port via the thrown error', () => {
    ;(setHttpPort as unknown as jest.Mock).mockImplementation(() => { throw new Error('Invalid port. Example: betty config set httpPort 8080') })

    expect(() => { configCommand('set', 'httpPort', 'abc') }).toThrow('Invalid port')
  })
})
