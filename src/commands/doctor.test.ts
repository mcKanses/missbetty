import { describe, expect, jest, test } from '@jest/globals'
import doctorCommand, { statusLine } from './doctor'
import { collectSetupStatus } from '../utils/setup'

jest.mock('../utils/setup', () => ({
  __esModule: true,
  collectSetupStatus: jest.fn(),
}))
jest.mock('../utils/hosts', () => ({ isWsl: () => false }))

describe('doctor command', () => {
  test('prints diagnostics for every linked domain and fails when one lacks a hosts entry', () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'shop.test',
      linkedDomains: ['app.dev', 'shop.test'],
      missingHostsEntries: ['shop.test'],
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(() => { doctorCommand() }).toThrow('Some checks failed')

    expect(logSpy).toHaveBeenCalledWith('✓ Docker installed')
    expect(logSpy).toHaveBeenCalledWith('✓ Docker running')
    expect(logSpy).toHaveBeenCalledWith('✗ mkcert installed')
    expect(logSpy).toHaveBeenCalledWith('✗ mkcert CA created')
    expect(logSpy).toHaveBeenCalledWith('✓ hosts entry for app.dev')
    expect(logSpy).toHaveBeenCalledWith('✗ hosts entry for shop.test')

    logSpy.mockRestore()
  })

  test('passes without mkcert: Betty then serves HTTP only', () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'betty.dev',
      linkedDomains: [],
      missingHostsEntries: [],
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(() => { doctorCommand() }).not.toThrow()
    expect(logSpy).toHaveBeenCalledWith('✓ hosts entries (no linked domains need one)')

    logSpy.mockRestore()
  })

  test('statusLine includes detail in parentheses when provided', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    statusLine('my check', true, 'v1.2.3')

    expect(logSpy).toHaveBeenCalledWith('✓ my check (v1.2.3)')
    logSpy.mockRestore()
  })
})