import { describe, expect, jest, test } from '@jest/globals'
import { printHelp } from './help'

jest.mock('./meta', () => ({
  __esModule: true,
  AUTHOR_INFO: 'test-author',
}))

describe('printHelp', () => {
  test('prints all betty commands', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printHelp()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('project')
    expect(output).toContain('serve')
    expect(output).toContain('link')
    expect(output).toContain('relink')
    expect(output).toContain('unlink')
    expect(output).toContain('status')
    expect(output).toContain('doctor')
    expect(output).toContain('setup')
    expect(output).toContain('config')

    logSpy.mockRestore()
  })

  test('prints usage examples', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printHelp()

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('betty project load')
    expect(output).toContain('betty project status')
    expect(output).toContain('betty serve')
    expect(output).toContain('betty link')
    expect(output).toContain('betty status')

    logSpy.mockRestore()
  })

  test('includes the title and author info', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printHelp()

    const firstLine = String(logSpy.mock.calls[0][0])
    expect(firstLine).toContain('betty')
    expect(firstLine).toContain('test-author')

    logSpy.mockRestore()
  })
})
