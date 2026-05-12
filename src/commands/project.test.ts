import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import fs from 'fs'
import inquirer from 'inquirer'
import { projectCreateCommand, projectLoadCommand, projectLinkCommand, projectStopCommand, projectStatusCommand, validateHttpTarget } from './project'
import { resolveConfigPath, readDevProjectConfig, runProjectCommand, linkProject, printUrls } from './dev'
import unlinkCommand from './unlink'
import { readRoutes } from '../utils/routes'

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
  resolveConfigPath: jest.fn(),
  readDevProjectConfig: jest.fn(),
  runProjectCommand: jest.fn(),
  linkProject: jest.fn(),
  printUrls: jest.fn(),
}))

jest.mock('./unlink', () => ({
  __esModule: true,
  default: jest.fn(),
}))

jest.mock('../utils/routes', () => ({
  readRoutes: jest.fn(),
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
  test('calls devCommand with mapped options in dry-run (no prompt)', async () => {
    await projectLoadCommand({ file: 'custom.yml', dryRun: true, yes: false })

    expect(devCommand).toHaveBeenCalledWith({ config: 'custom.yml', dryRun: true, yes: false })
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })

  test('skips prompt and calls devCommand when --yes is set', async () => {
    await projectLoadCommand({ file: 'custom.yml', yes: true })

    expect(devCommand).toHaveBeenCalledWith({ config: 'custom.yml', dryRun: undefined, yes: true })
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })

  test('shows confirmation prompt and calls devCommand on confirm', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue({ project: 'my-app', domains: [] })
    mockPromptSequence({ confirm: true })

    await projectLoadCommand({})

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'confirm' })])
    )
    expect(devCommand).toHaveBeenCalled()
  })

  test('cancels without calling devCommand when user declines', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue({ project: 'my-app', domains: [] })
    mockPromptSequence({ confirm: false })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectLoadCommand({})

    expect(logSpy).toHaveBeenCalledWith('Cancelled.')
    expect(devCommand).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('exits with code 1 when resolveConfigPath throws', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockImplementation(() => { throw new Error('No .betty.yml found') })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(projectLoadCommand({})).rejects.toThrow('process-exit-1')

    errorSpy.mockRestore()
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

describe('projectLinkCommand', () => {
  const mockConfig = {
    project: 'my-app',
    domains: [{ host: 'my-app.localhost', target: 'http://127.0.0.1:3000' }],
  }

  test('prompts for confirmation when no --file and no --yes, then links on confirm', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(linkProject as unknown as jest.Mock).mockResolvedValue(undefined as never)
    mockPromptSequence({ confirm: true })

    await projectLinkCommand({})

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'confirm', message: expect.stringContaining('my-app') })])
    )
    expect(linkProject).toHaveBeenCalledWith(mockConfig, { yes: undefined })
    expect(printUrls).toHaveBeenCalledWith(mockConfig)
  })

  test('cancels when user declines confirmation', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    mockPromptSequence({ confirm: false })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectLinkCommand({})

    expect(logSpy).toHaveBeenCalledWith('Cancelled.')
    expect(linkProject).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('skips prompt when --yes is set', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(linkProject as unknown as jest.Mock).mockResolvedValue(undefined as never)

    await projectLinkCommand({ yes: true })

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(linkProject).toHaveBeenCalledWith(mockConfig, { yes: true })
  })

  test('skips prompt when --file is set', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/custom/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(linkProject as unknown as jest.Mock).mockResolvedValue(undefined as never)

    await projectLinkCommand({ file: 'custom.yml' })

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(resolveConfigPath).toHaveBeenCalledWith('custom.yml')
    expect(linkProject).toHaveBeenCalledWith(mockConfig, { yes: undefined })
  })

  test('exits with code 1 when linkProject throws', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(linkProject as unknown as jest.Mock).mockRejectedValue(new Error('proxy failed') as never)
    mockPromptSequence({ confirm: true })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(projectLinkCommand({})).rejects.toThrow('process-exit-1')

    errorSpy.mockRestore()
  })
})

describe('projectStopCommand', () => {
  const mockConfig = {
    project: 'my-app',
    domains: [{ host: 'my-app.localhost', target: 'http://127.0.0.1:3000' }],
  }

  const mockConfigWithDown = {
    ...mockConfig,
    down: { command: 'docker compose down' },
  }

  test('runs down command and unlinks when --yes is passed', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfigWithDown)
    ;(unlinkCommand as unknown as jest.Mock).mockResolvedValue(undefined as never)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStopCommand({ yes: true })

    expect(runProjectCommand).toHaveBeenCalledWith('docker compose down', '/project/.betty.yml')
    expect(unlinkCommand).toHaveBeenCalledWith({ project: 'my-app', yes: true })
    expect(logSpy).toHaveBeenCalledWith('Running: docker compose down')

    logSpy.mockRestore()
  })

  test('skips down command when none configured', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(unlinkCommand as unknown as jest.Mock).mockResolvedValue(undefined as never)

    await projectStopCommand({ yes: true })

    expect(runProjectCommand).not.toHaveBeenCalled()
    expect(unlinkCommand).toHaveBeenCalledWith({ project: 'my-app', yes: true })
  })

  test('logs Cancelled and does nothing when user declines confirm', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    mockPromptSequence({ confirm: false })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStopCommand({})

    expect(logSpy).toHaveBeenCalledWith('Cancelled.')
    expect(unlinkCommand).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('unlinks when user confirms stop', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(unlinkCommand as unknown as jest.Mock).mockResolvedValue(undefined as never)
    mockPromptSequence({ confirm: true })

    await projectStopCommand({})

    expect(unlinkCommand).toHaveBeenCalledWith({ project: 'my-app', yes: true })
  })

  test('exits with code 1 when resolveConfigPath throws', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockImplementation(() => { throw new Error('No .betty.yml found') })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(projectStopCommand({ yes: true })).rejects.toThrow('process-exit-1')

    errorSpy.mockRestore()
  })
})

describe('projectStatusCommand', () => {
  const mockConfig = {
    project: 'my-app',
    domains: [
      { host: 'my-app.localhost', target: 'http://127.0.0.1:3000' },
      { host: 'api.localhost', target: 'http://127.0.0.1:8080' },
    ],
  }

  test('shows "no project specified" message when no --file and no local .betty.yml found', async () => {
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([])
    ;(resolveConfigPath as unknown as jest.Mock).mockImplementation(() => { throw new Error('No .betty.yml found') })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStatusCommand({})

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('No project specified')

    logSpy.mockRestore()
  })

  test('prompts with found project name when local .betty.yml exists and shows table on confirm', async () => {
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([
      { domain: 'my-app.localhost', routerName: 'my-app', fileName: 'my-app.yml', filePath: '/path/my-app.yml', target: 'http://127.0.0.1:3000' },
    ])
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    mockPromptSequence({ confirm: true })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStatusCommand({})

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'confirm', message: expect.stringContaining("my-app") })])
    )
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('my-app')

    logSpy.mockRestore()
  })

  test('cancels when user declines the found project prompt', async () => {
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([])
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    mockPromptSequence({ confirm: false })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStatusCommand({})

    expect(logSpy).toHaveBeenCalledWith('Cancelled.')

    logSpy.mockRestore()
  })

  test('shows linked domains table when --name matches linked routes', async () => {
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([
      { domain: 'ory-ui.mckansescloud.dev', routerName: 'mckanses-auth', fileName: 'mckanses-auth.yml', filePath: '/path/mckanses-auth.yml', target: 'http://127.0.0.1:5173' },
      { domain: 'api.mckansescloud.dev', routerName: 'mckanses-auth', fileName: 'mckanses-auth.yml', filePath: '/path/mckanses-auth.yml', target: 'http://127.0.0.1:8080' },
    ])

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStatusCommand({ name: 'mckanses-auth' })

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('mckanses-auth')
    expect(output).toContain('ory-ui.mckansescloud.dev')
    expect(output).toContain('api.mckansescloud.dev')
    expect(inquirer.prompt).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('exits with code 1 when --name does not match any linked project', async () => {
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([])

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(projectStatusCommand({ name: 'nonexistent' })).rejects.toThrow('process-exit-1')

    errorSpy.mockRestore()
  })

  test('renders table with linked and unlinked rows when --file is given', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/project/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([
      { domain: 'my-app.localhost', routerName: 'my-app', fileName: 'my-app.yml', filePath: '/path/my-app.yml', target: 'http://127.0.0.1:3000' },
    ])

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStatusCommand({ file: '.betty.yml' })

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('my-app')
    expect(output).toContain('status')
    expect(output).toContain('domain')
    expect(output).toContain('target')
    expect(output).toContain('linked')
    expect(output).toContain('unlinked')

    logSpy.mockRestore()
  })

  test('passes --file to resolveConfigPath', async () => {
    ;(resolveConfigPath as unknown as jest.Mock).mockReturnValue('/custom/.betty.yml')
    ;(readDevProjectConfig as unknown as jest.Mock).mockReturnValue(mockConfig)
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([])

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await projectStatusCommand({ file: 'custom.yml' })

    expect(resolveConfigPath).toHaveBeenCalledWith('custom.yml')

    logSpy.mockRestore()
  })

  test('exits with code 1 when resolveConfigPath throws', async () => {
    ;(readRoutes as unknown as jest.Mock).mockReturnValue([])
    ;(resolveConfigPath as unknown as jest.Mock).mockImplementation(() => { throw new Error('No .betty.yml found') })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(projectStatusCommand({ file: '.betty.yml' })).rejects.toThrow('process-exit-1')

    errorSpy.mockRestore()
  })
})
