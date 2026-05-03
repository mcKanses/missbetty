import { describe, expect, jest, test } from '@jest/globals'
import doctorCommand from './doctor'
import { collectSetupStatus } from '../utils/setup'

jest.mock('../utils/setup', () => ({
  __esModule: true,
  collectSetupStatus: jest.fn(),
}))

describe('doctor command', () => {
  test('prints diagnostics status without mutating system state', () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'wienenergie.dev',
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    doctorCommand()

    expect(logSpy).toHaveBeenCalledWith('✓ Docker installed')
    expect(logSpy).toHaveBeenCalledWith('✓ Docker running')
    expect(logSpy).toHaveBeenCalledWith('✗ mkcert installed')
    expect(logSpy).toHaveBeenCalledWith('✗ mkcert CA installed')
    expect(logSpy).toHaveBeenCalledWith('✗ hosts entry exists for wienenergie.dev')

    logSpy.mockRestore()
  })
})