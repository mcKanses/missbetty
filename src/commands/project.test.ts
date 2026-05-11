import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import fs from 'fs'
import inquirer from 'inquirer'
import projectCommand, { projectCreateCommand, projectLoadCommand } from './project'

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}))

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

jest.mock('./dev', () => ({
  __esModule: true,
  default: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const devCommand = require('./dev').default as jest.Mock

const mockPromptSequence = (...responses: unknown[]): void => {
  const p = inquirer.prompt as unknown as jest.Mock
  for (const r of responses) p.mockResolvedValueOnce(r as never)
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
    throw new Error(`process-exit-${String(code)}`)
  })
  devCommand.mockResolvedValue(undefined as never)
})

describe('projectLoadCommand', () => {
  test('calls devCommand with mapped options', async () => {
    await projectLoadCommand({ file: 'custom.yml', dryRun: true, yes: false })

    expect(devCommand).toHaveBeenCalledWith({ config: 'custom.yml', dryRun: true, yes: false })
  })
})

describe('projectCommand (no subcommand)', () => {
  test('asks to load when .betty.yml exists and starts on confirm', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('project: my-app\ndomains: []\n')
    mockPromptSequence({ load: true })

    await projectCommand()

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'load' })])
    )
    expect(devCommand).toHaveBeenCalled()
  })

  test('does not start when user declines load', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('project: my-app\ndomains: []\n')
    mockPromptSequence({ load: false })

    await projectCommand()

    expect(devCommand).not.toHaveBeenCalled()
  })

  test('asks to create when no .betty.yml found', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence({ create: false })

    await projectCommand()

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'create' })])
    )
    expect(devCommand).not.toHaveBeenCalled()
  })

  test('starts create wizard when user confirms', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { create: true },
      { projectName: 'my-app' },
      { host: 'my-app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '' },
      { startNow: false }
    )

    await projectCommand()

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.betty.yml'),
      expect.stringContaining('my-app'),
      'utf8'
    )
  })
})

describe('projectCreateCommand', () => {
  test('writes .betty.yml with all provided values', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'test-project' },
      { host: 'api.localhost', target: 'http://127.0.0.1:8080' },
      { another: false },
      { httpsEnabled: false, upCommand: 'docker compose up', downCommand: 'docker compose down' },
      { startNow: false }
    )

    await projectCreateCommand({})

    const written = (fs.writeFileSync as unknown as jest.Mock).mock.calls[0]
    expect(written[0]).toContain('.betty.yml')
    const content = String(written[1])
    expect(content).toContain('project: test-project')
    expect(content).toContain('host: api.localhost')
    expect(content).toContain('target: http://127.0.0.1:8080')
    expect(content).toContain('command: docker compose up')
    expect(content).toContain('command: docker compose down')
  })

  test('includes https block when enabled', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'secure-app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: true, upCommand: '', downCommand: '' },
      { startNow: false }
    )

    await projectCreateCommand({})

    const content = String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])
    expect(content).toContain('enabled: true')
    expect(content).toContain('certificateAuthority: missbetty')
  })

  test('uses --name option as default for project name prompt', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'preset-name' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '' },
      { startNow: false }
    )

    await projectCreateCommand({ name: 'preset-name' })

    const namePrompt = (inquirer.prompt as unknown as jest.Mock).mock.calls[0]
    expect((namePrompt[0] as { default?: string }[])[0].default).toBe('preset-name')
  })

  test('supports adding multiple domains via loop', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'multi' },
      { host: 'ui.localhost', target: 'http://127.0.0.1:5173' },
      { another: true },
      { host: 'api.localhost', target: 'http://127.0.0.1:8080' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '' },
      { startNow: false }
    )

    await projectCreateCommand({})

    const content = String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])
    expect(content).toContain('ui.localhost')
    expect(content).toContain('api.localhost')
  })

  test('asks to overwrite when .betty.yml already exists and cancels on decline', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    mockPromptSequence({ overwrite: false })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectCreateCommand({})

    expect(logSpy).toHaveBeenCalledWith('Cancelled.')
    expect(fs.writeFileSync).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('proceeds when user confirms overwrite', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    mockPromptSequence(
      { overwrite: true },
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '' },
      { startNow: false }
    )

    await projectCreateCommand({})

    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  test('starts devCommand after creation when user confirms', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '' },
      { startNow: true }
    )

    await projectCreateCommand({})

    expect(devCommand).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.stringContaining('.betty.yml') })
    )
  })
})
