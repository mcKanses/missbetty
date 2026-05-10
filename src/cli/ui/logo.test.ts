import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { animateBettyLogo, printBettyLogo } from './logo'

describe('printBettyLogo', () => {
  test('outputs logo lines to console', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printBettyLogo()

    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('betty')

    logSpy.mockRestore()
  })
})

describe('animateBettyLogo', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('prints static logo when stdout is not a TTY', async () => {
    const originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    const promise = animateBettyLogo()
    jest.runAllTimers()
    await promise

    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('betty')

    logSpy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  test('runs animation frames when stdout is a TTY', async () => {
    const originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })

    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    const promise = animateBettyLogo()
    await jest.runAllTimersAsync()
    await promise

    expect(writeSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalled()

    writeSpy.mockRestore()
    logSpy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
  })
})
