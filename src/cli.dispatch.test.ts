import { describe, expect, test, beforeEach, jest } from '@jest/globals'

jest.mock('./commands/link', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/rest', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/serve', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/relink', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/status', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/unlink', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/config', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/doctor', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/setup', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/dev', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./commands/project', () => ({
  __esModule: true,
  projectCreateCommand: jest.fn(),
  projectLoadCommand: jest.fn(),
  projectLinkCommand: jest.fn(),
  projectStopCommand: jest.fn(),
  projectStatusCommand: jest.fn(),
}))

jest.mock('./cli/ui/help', () => ({ printHelp: jest.fn() }))
jest.mock('./cli/ui/logo', () => ({ animateBettyLogo: jest.fn(), printBettyLogo: jest.fn() }))
jest.mock('./cli/ui/meta', () => ({ AUTHOR_INFO: 'author-info' }))

import linkCommand from './commands/link'
import restCommand from './commands/rest'
import serveCommand from './commands/serve'
import relinkCommand from './commands/relink'
import statusCommand from './commands/status'
import unlinkCommand from './commands/unlink'
import configCommand from './commands/config'
import doctorCommand from './commands/doctor'
import setupCommand from './commands/setup'
import devCommand from './commands/dev'
import {
  projectCreateCommand,
  projectLoadCommand,
  projectLinkCommand,
  projectStopCommand,
  projectStatusCommand,
} from './commands/project'
import { printHelp } from './cli/ui/help'
import { animateBettyLogo, printBettyLogo } from './cli/ui/logo'
import { createProgram, run } from './cli'
import { BettyError } from './utils/errors'

// Build a node-style argv (node + script + user args) for program.parse / run.
const argv = (...args: string[]): string[] => ['node', 'betty', ...args]

const parse = (...args: string[]): void => { createProgram().parse(argv(...args)) }

beforeEach(() => {
  jest.clearAllMocks()
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

describe('createProgram dispatch', () => {
  test('link forwards container and options', () => {
    parse('link', 'myapp', '--domain', 'my-app.localhost', '--port', '3000', '--dry-run', '--open', '-y')

    expect(linkCommand).toHaveBeenCalledWith(
      'myapp',
      expect.objectContaining({ domain: 'my-app.localhost', port: '3000', dryRun: true, open: true, yes: true })
    )
  })

  test('link works without a container argument', () => {
    parse('link')

    expect(linkCommand).toHaveBeenCalledWith(undefined, expect.any(Object))
  })

  test('relink forwards target and options', () => {
    parse('relink', 'myapp', '--container', 'web-1', '--domain', 'd.localhost', '--port', '8080', '-y')

    expect(relinkCommand).toHaveBeenCalledWith(
      'myapp',
      expect.objectContaining({ container: 'web-1', domain: 'd.localhost', port: '8080', yes: true })
    )
  })

  test('unlink forwards options', () => {
    parse('unlink', '--domain', 'd.localhost', '--all', '-y')

    expect(unlinkCommand).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'd.localhost', all: true, yes: true })
    )
  })

  test('status forwards options', () => {
    parse('status', '--long', '--json')

    expect(statusCommand).toHaveBeenCalledWith(expect.objectContaining({ long: true, json: true }))
  })

  test('dev forwards options', () => {
    parse('dev', '--config', '/tmp/.betty.yml', '--dry-run', '-y')

    expect(devCommand).toHaveBeenCalledWith(
      expect.objectContaining({ config: '/tmp/.betty.yml', dryRun: true, yes: true })
    )
  })

  test('config forwards positional arguments', () => {
    parse('config', 'set', 'domainSuffix', '.localhost')

    expect(configCommand).toHaveBeenCalledWith('set', 'domainSuffix', '.localhost')
  })

  test('serve invokes the serve command', () => {
    parse('serve')

    expect(serveCommand).toHaveBeenCalled()
  })

  test('stop invokes the rest command', () => {
    parse('stop', '-y')

    expect(restCommand).toHaveBeenCalledWith(expect.objectContaining({ yes: true }))
  })

  test('rest is an alias for stop', () => {
    parse('rest', '-y')

    expect(restCommand).toHaveBeenCalledWith(expect.objectContaining({ yes: true }))
  })

  test('doctor invokes the doctor command', () => {
    parse('doctor')

    expect(doctorCommand).toHaveBeenCalled()
  })

  test('setup forwards options', () => {
    parse('setup', '--fix', '-y')

    expect(setupCommand).toHaveBeenCalledWith(expect.objectContaining({ fix: true, yes: true }))
  })
})

describe('createProgram project subcommands', () => {
  test('project load forwards options', () => {
    parse('project', 'load', '--file', '/tmp/.betty.yml', '--dry-run', '-y')

    expect(projectLoadCommand).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/tmp/.betty.yml', dryRun: true, yes: true })
    )
  })

  test('project create forwards the name option', () => {
    parse('project', 'create', '--name', 'demo')

    expect(projectCreateCommand).toHaveBeenCalledWith(expect.objectContaining({ name: 'demo' }))
  })

  test('project unlink maps the name argument to unlinkCommand', () => {
    parse('project', 'unlink', 'demo', '-y')

    expect(unlinkCommand).toHaveBeenCalledWith({ project: 'demo', yes: true })
  })

  test('project link forwards options', () => {
    parse('project', 'link', '--file', '/tmp/.betty.yml', '-y')

    expect(projectLinkCommand).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/tmp/.betty.yml', yes: true })
    )
  })

  test('project stop forwards options', () => {
    parse('project', 'stop', '--file', '/tmp/.betty.yml', '-y')

    expect(projectStopCommand).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/tmp/.betty.yml', yes: true })
    )
  })

  test('project status forwards options', () => {
    parse('project', 'status', '--name', 'demo')

    expect(projectStatusCommand).toHaveBeenCalledWith(expect.objectContaining({ name: 'demo' }))
  })

  test('hidden project serve hints at the top-level serve command', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    parse('project', 'serve')

    expect(logSpy).toHaveBeenCalledWith("Did you mean 'betty serve'?")
  })
})

describe('run', () => {
  test('shows the logo and exits when no command is given', async () => {
    await expect(run(argv())).rejects.toThrow('process-exit-0')

    expect(animateBettyLogo).toHaveBeenCalled()
  })

  test('prints help and exits for the help command', async () => {
    await expect(run(argv('help'))).rejects.toThrow('process-exit-0')

    expect(printBettyLogo).toHaveBeenCalled()
    expect(printHelp).toHaveBeenCalled()
  })

  test('help lists exactly the registered top-level commands (drift guard)', async () => {
    await expect(run(argv('help'))).rejects.toThrow('process-exit-0')

    const passed = (printHelp as unknown as jest.Mock).mock.calls[0][0] as { name: string }[]
    const expectedNames = createProgram().commands.map((command) => command.name())
    expect(passed.map((command) => command.name)).toEqual(expectedNames)
  })

  test('parses and dispatches a real command', async () => {
    await run(argv('status', '--json'))

    expect(statusCommand).toHaveBeenCalledWith(expect.objectContaining({ json: true }))
  })

  test('maps a BettyError thrown by a command to printError, its hints and exit code', async () => {
    ;(configCommand as unknown as jest.Mock).mockImplementation(() => {
      throw new BettyError('boom', { hints: ['try this instead'] })
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(run(argv('config', 'get', 'bad'))).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('try this instead'))

    errorSpy.mockRestore()
  })
})
