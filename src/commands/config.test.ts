import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import configCommand from './config'
import { getDomainSuffix, setDomainSuffix } from '../utils/config'

jest.mock('../utils/config', () => ({
  __esModule: true,
  getDomainSuffix: jest.fn(),
  getStoredDomainSuffix: jest.fn(),
  setDomainSuffix: jest.fn(),
}))

describe('config command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })
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
    expect(errorSpy).toHaveBeenCalledWith('Unknown config key. Supported: domainSuffix')

    errorSpy.mockRestore()
  })
})
