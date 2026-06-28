import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import configCommand from './config'
import { getDomainSuffix, getStoredDomainSuffix, setDomainSuffix } from '../utils/config'

jest.mock('../utils/config', () => ({
  __esModule: true,
  getDomainSuffix: jest.fn(),
  getStoredDomainSuffix: jest.fn(),
  setDomainSuffix: jest.fn(),
}))

describe('config command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.BETTY_DOMAIN_SUFFIX
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

  test('exits with 1 for unknown key', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('get', 'other') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config key. Supported: domainSuffix'))

    errorSpy.mockRestore()
  })

  test('exits with 1 when set is given an unknown key', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('set', 'other', '.localhost') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config key. Supported: domainSuffix'))
    expect(setDomainSuffix).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  test('exits with 1 when set is missing a value', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('set', 'domainSuffix') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing value'))
    expect(setDomainSuffix).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  test('exits with 1 when set value is only whitespace', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('set', 'domainSuffix', '   ') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing value'))
    expect(setDomainSuffix).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  test('exits with 1 and reports the error when setDomainSuffix throws', () => {
    ;(setDomainSuffix as unknown as jest.Mock).mockImplementation(() => { throw new Error('disk full') })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('set', 'domainSuffix', '.localhost') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'))

    errorSpy.mockRestore()
  })

  test('stringifies a non-Error thrown by setDomainSuffix', () => {
    ;(setDomainSuffix as unknown as jest.Mock).mockImplementation(() => {
      const failure: unknown = 'plain string failure'
      throw failure
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('set', 'domainSuffix', '.localhost') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('plain string failure'))

    errorSpy.mockRestore()
  })

  test('exits with 1 for an unrecognized action', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => { configCommand('bogus') }).toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: betty config [get|set] domainSuffix [value]'))

    errorSpy.mockRestore()
  })
})
