import { describe, expect, jest, test } from '@jest/globals'
import { printHelp, type HelpCommand } from './help'

jest.mock('./meta', () => ({
  __esModule: true,
  AUTHOR_INFO: 'test-author',
}))

const COMMANDS: HelpCommand[] = [
  { name: 'project', description: 'Manage betty projects' },
  { name: 'serve', description: 'start service' },
  { name: 'status', description: 'show status' },
  { name: 'link', description: 'connect a service to a domain' },
  { name: 'relink', description: 'update a link' },
  { name: 'unlink', description: 'remove a link' },
  { name: 'config', description: 'read or update settings' },
  { name: 'doctor', description: 'run diagnostics' },
  { name: 'setup', description: 'interactive setup' },
]

describe('printHelp', () => {
  test('prints every command it is given', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printHelp(COMMANDS)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    for (const { name, description } of COMMANDS) {
      expect(output).toContain(name)
      expect(output).toContain(description)
    }

    logSpy.mockRestore()
  })

  test('prints usage examples', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    printHelp(COMMANDS)

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

    printHelp(COMMANDS)

    const firstLine = String(logSpy.mock.calls[0][0])
    expect(firstLine).toContain('betty')
    expect(firstLine).toContain('test-author')

    logSpy.mockRestore()
  })
})
