import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import fs from 'fs'
import inquirer from 'inquirer'
import projectCommand, { projectCreateCommand, projectLoadCommand, validateHttpTarget } from './project'

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

describe('validateHttpTarget', () => {
  test('returns true for a valid http URL', () => {
    expect(validateHttpTarget('http://127.0.0.1:3000')).toBe(true)
  })

  test('returns true for a valid https URL', () => {
    expect(validateHttpTarget('https://example.com')).toBe(true)
  })

  test('returns error string for a non-URL value', () => {
    expect(validateHttpTarget('not-a-url')).toBe('Must be a valid http(s) URL.')
  })

  test('returns error string for a non-http(s) protocol', () => {
    expect(validateHttpTarget('ftp://example.com')).toBe('Must be an http(s) URL.')
  })
})

describe('projectLoadCommand', () => {
  test('calls devCommand with mapped options', async () => {
    await projectLoadCommand({ file: 'custom.yml', dryRun: true, yes: false })

    expect(devCommand).toHaveBeenCalledWith({ config: 'custom.yml', dryRun: true, yes: false })
  })
})

describe('projectCommand (no subcommand)', () => {
  test('displays domain list and asks to load when .betty.yml exists', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue([
      'project: my-app',
      'domains:',
      '  - host: my-app.localhost',
      '    target: http://127.0.0.1:3000',
    ].join('\n'))
    mockPromptSequence({ load: true })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectCommand()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-app'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-app.localhost'))
    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'load' })])
    )
    expect(devCommand).toHaveBeenCalled()

    logSpy.mockRestore()
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

  test('catches error thrown by devCommand and exits with code 1', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('project: my-app\ndomains: []\n')
    mockPromptSequence({ load: true })
    devCommand.mockRejectedValueOnce(new Error('oops') as never)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(projectCommand()).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('oops'))

    errorSpy.mockRestore()
  })

  test('starts create wizard when user confirms', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { create: true },
      { projectName: 'my-app' },
      { host: 'my-app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
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
      { httpsEnabled: false, upCommand: 'docker compose up', downCommand: 'docker compose down', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    const written = (fs.writeFileSync as unknown as jest.Mock).mock.calls[0]
    expect(written[0]).toContain('.betty.yml')
    const content = String(written[1])
    expect(content).toContain('test-project')
    expect(content).toContain('api.localhost')
    expect(content).toContain('http://127.0.0.1:8080')
    expect(content).toContain('docker compose up')
    expect(content).toContain('docker compose down')
  })

  test('includes https block when enabled', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'secure-app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: true, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    const content = String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])
    expect(content).toContain('enabled: true')
    expect(content).toContain('certificateAuthority: missbetty')
  })

  test('writes permissions block when autoApprove is true', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: true },
      { startNow: false }
    )

    await projectCreateCommand({})

    const content = String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])
    expect(content).toContain('hosts: allowed')
    expect(content).toContain('docker: allowed')
    expect(content).toContain('trustStore: allowed')
  })

  test('omits permissions block when autoApprove is false', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    const content = String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])
    expect(content).not.toContain('permissions')
  })

  test('handles project name with YAML special characters safely', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'my: tricky & project' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    const content = String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])
    // yaml.stringify should quote the value so the file is valid YAML
    expect(content).toContain('my: tricky & project')
    // Verify it can be re-parsed without error
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const parsedYaml = require('yaml') as { parse: (s: string) => { project?: string } }
    expect(() => parsedYaml.parse(content)).not.toThrow()
    expect(parsedYaml.parse(content).project).toBe('my: tricky & project')
  })

  test('validate callback rejects empty project name', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    interface PromptQuestion { name: string; validate?: (v: string) => string | boolean }
    const nameQuestion = ((inquirer.prompt as unknown as jest.Mock).mock.calls[0][0] as PromptQuestion[])[0]
    expect(nameQuestion.validate?.('')).toBe('Project name is required.')
    expect(nameQuestion.validate?.('  ')).toBe('Project name is required.')
    expect(nameQuestion.validate?.('ok')).toBe(true)
  })

  test('validate callback rejects empty domain host', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    interface PromptQuestion { name: string; validate?: (v: string) => string | boolean }
    const domainQuestions = (inquirer.prompt as unknown as jest.Mock).mock.calls[1][0] as PromptQuestion[]
    const hostQuestion = domainQuestions.find((q) => q.name === 'host')
    expect(hostQuestion?.validate?.('')).toBe('Host is required.')
    expect(hostQuestion?.validate?.('app.localhost')).toBe(true)
  })

  test('uses --name option as default for project name prompt', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'preset-name' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
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
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
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
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: false }
    )

    await projectCreateCommand({})

    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  test('passes yes:true to devCommand when starting after creation', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    mockPromptSequence(
      { projectName: 'app' },
      { host: 'app.localhost', target: 'http://127.0.0.1:3000' },
      { another: false },
      { httpsEnabled: false, upCommand: '', downCommand: '', autoApprove: false },
      { startNow: true }
    )

    await projectCreateCommand({})

    expect(devCommand).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.stringContaining('.betty.yml'), yes: true })
    )
  })
})
