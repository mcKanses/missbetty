import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import unlinkCommand from './unlink'

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}))

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}))

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

const YAML_APP_ROUTE = [
  'http:',
  '  routers:',
  '    app:',
  '      rule: \'Host("app.localhost")\'',
  '      entryPoints: [web]',
  '      service: app',
  '  services:',
  '    app:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://172.18.0.2:5173',
].join('\n')

const YAML_MULTI_DOMAIN = [
  'http:',
  '  routers:',
  '    mckanses-auth-1:',
  '      rule: \'Host("ory-ui.mckansescloud.dev")\'',
  '      entryPoints: [web]',
  '      service: mckanses-auth-1',
  '    mckanses-auth-2:',
  '      rule: \'Host("api.mckansescloud.dev")\'',
  '      entryPoints: [web]',
  '      service: mckanses-auth-2',
  '  services:',
  '    mckanses-auth-1:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://host.docker.internal:5173',
  '    mckanses-auth-2:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://host.docker.internal:8080',
].join('\n')

const YAML_DEV_ROUTE = [
  'http:',
  '  routers:',
  '    app:',
  '      rule: \'Host("ory-ui.mckanses-auth.dev")\'',
  '      entryPoints: [web]',
  '      service: app',
  '  services:',
  '    app:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://172.18.0.2:5173',
].join('\n')

const YAML_MULTI_WITH_TLS = [
  'http:',
  '  routers:',
  '    app1:',
  "      rule: 'Host(\"app1.localhost\")'",
  '      entryPoints: [web]',
  '      service: app1',
  '    app2:',
  "      rule: 'Host(\"app2.localhost\")'",
  '      entryPoints: [web]',
  '      service: app2',
  '  services:',
  '    app1:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://172.18.0.2:5173',
  '    app2:',
  '      loadBalancer:',
  '        servers:',
  '          - url: http://172.18.0.3:8080',
  'tls:',
  '  certificates:',
  '    - certFile: /home/test-user/.betty/certs/app1.localhost.pem',
  '      keyFile: /home/test-user/.betty/certs/app1.localhost-key.pem',
  '    - certFile: /home/test-user/.betty/certs/app2.localhost.pem',
  '      keyFile: /home/test-user/.betty/certs/app2.localhost-key.pem',
].join('\n')

const normalizePath = (p: string) => p.replace(/\\/g, '/')

describe('unlink command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('logs error and exits when Betty proxy is not set up', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(unlinkCommand()).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Betty's proxy is not set up yet. Run: betty serve"))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('logs "No links found." when dynamic dir has no routes', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue([])

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(logSpy).toHaveBeenCalledWith('No links found.')
    expect(fs.unlinkSync).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('logs "No links found." when dynamic dir does not exist', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml')
      // dynamic dir doesn't exist → readRoutes returns []
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(logSpy).toHaveBeenCalledWith('No links found.')

    logSpy.mockRestore()
  })

  test('removes route file and restarts Traefik when user confirms', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('app')

    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('app.yml'))
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('restart traefik'),
      expect.objectContaining({ stdio: 'inherit' })
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removed link:'))

    logSpy.mockRestore()
  })

  test('skips route list prompt when only one link exists', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: true }))

    await unlinkCommand()

    expect(inquirer.prompt).toHaveBeenCalledTimes(1)
    expect(inquirer.prompt).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ type: 'confirm', name: 'confirm' }),
    ]))
  })

  test('logs "Cancelled." and does not delete file when user cancels', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: false }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('app')

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Cancelled.')

    logSpy.mockRestore()
  })

  test('exits when target has no match', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(unlinkCommand('nonexistent')).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No link found for target 'nonexistent'"))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('matches route by domain option', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand(undefined, { domain: 'app.localhost' })

    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('app.yml'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removed link:'))

    logSpy.mockRestore()
  })

  test('--all removes all routes after confirmation', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml') ||
        np.endsWith('/.betty/dynamic/dev.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'dev.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      if (np.endsWith('dev.yml')) return YAML_DEV_ROUTE
      return YAML_APP_ROUTE
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirmAll: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand(undefined, { all: true })

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2)
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('restart traefik'), expect.anything())
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Summary:'))

    logSpy.mockRestore()
  })

  test('--all cancels without removing when user declines', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirmAll: false }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand(undefined, { all: true })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Cancelled.')

    logSpy.mockRestore()
  })

  test('shows checkbox when multiple routes exist and no target given', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') || np.endsWith('/.betty/dynamic') || np.endsWith('/app.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'dev.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('dev.yml')) return YAML_DEV_ROUTE
      return YAML_APP_ROUTE
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      const q = (questions as { type: string; choices?: { value: unknown }[] }[])[0]
      if (q.type === 'checkbox') {
        const first = q.choices?.[0]?.value
        return Promise.resolve({ selected: first !== undefined ? [first] : [] })
      }
      return Promise.resolve({ confirm: true })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'checkbox', name: 'selected' })])
    )
    expect(fs.unlinkSync).toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('shows disambiguation prompt when target matches multiple routes', async () => {
    const YAML_APP_DUPLICATE = [
      'http:',
      '  routers:',
      '    app:',
      '      rule: \'Host("app2.localhost")\'',
      '      entryPoints: [web]',
      '      service: app',
      '  services:',
      '    app:',
      '      loadBalancer:',
      '        servers:',
      '          - url: http://172.18.0.3:5173',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') || np.endsWith('/.betty/dynamic') || np.endsWith('/app.yml') || np.endsWith('/app2.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'app2.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('app2.yml')) return YAML_APP_DUPLICATE
      return YAML_APP_ROUTE
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      const q = (questions as { type: string; choices?: { value: string }[] }[])[0]
      if (q.type === 'list' && q.choices !== undefined) return Promise.resolve({ selection: q.choices[0].value })
      return Promise.resolve({ confirm: true })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('app')

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Multiple matches') })])
    )

    logSpy.mockRestore()
  })

  test('exits when route file is missing at unlink time', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') || np.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: true }))

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    await expect(unlinkCommand('app')).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Routing file not found'))

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('keeps hosts entry when domain is still used by another route', async () => {
    const YAML_SAME_DOMAIN = [
      'http:',
      '  routers:',
      '    app2:',
      '      rule: \'Host("app.localhost")\'',
      '      entryPoints: [web]',
      '      service: app2',
      '  services:',
      '    app2:',
      '      loadBalancer:',
      '        servers:',
      '          - url: http://172.18.0.3:5173',
    ].join('\n')

    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') || np.endsWith('/.betty/dynamic') || np.endsWith('/app.yml') || np.endsWith('/app2.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'app2.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('app2.yml')) return YAML_SAME_DOMAIN
      return YAML_APP_ROUTE
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('app')

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Keeping hosts entry'))

    logSpy.mockRestore()
  })

  test('--all reports failed domain when route file is missing', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') || np.endsWith('/.betty/dynamic')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_APP_ROUTE)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirmAll: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await unlinkCommand(undefined, { all: true })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Routing file not found'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('❌'))

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('logs "Nothing selected." when checkbox is submitted empty', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return np.endsWith('/.betty/docker-compose.yml') || np.endsWith('/.betty/dynamic') || np.endsWith('/app.yml')
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml', 'dev.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      if (normalizePath(String(p)).endsWith('dev.yml')) return YAML_DEV_ROUTE
      return YAML_APP_ROUTE
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ selected: [] }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(logSpy).toHaveBeenCalledWith('Nothing selected.')
    expect(fs.unlinkSync).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  test('shows checkbox for multi-domain project and removes entire project when "all in project" is selected', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/mckanses-auth.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock)
      .mockReturnValueOnce(['mckanses-auth.yml'])
      .mockReturnValueOnce([])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_DOMAIN)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      const q = (questions as { type: string; choices?: { value: unknown }[] }[])[0]
      if (q.type === 'checkbox') {
        const projectChoice = q.choices?.find((c) => (c.value as { kind?: string }).kind === 'project')
        return Promise.resolve({ selected: projectChoice !== undefined ? [projectChoice.value] : [] })
      }
      return Promise.resolve({ confirm: true })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mckanses-auth.yml'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✅ removed:'))

    logSpy.mockRestore()
  })

  test('skips scope prompt and removes only matched domain when --yes is passed', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/mckanses-auth.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['mckanses-auth.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_DOMAIN)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('mckanses-auth', { yes: true })

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('mckanses-auth.yml'),
      expect.stringContaining('mckanses-auth-2'),
      'utf8'
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removed link:'))

    logSpy.mockRestore()
  })

  test('removes entire project without asking when --all is passed with a target', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/mckanses-auth.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['mckanses-auth.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_DOMAIN)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('mckanses-auth', { all: true })

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mckanses-auth.yml'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removed project:'))

    logSpy.mockRestore()
  })

  test('removes only one router from a multi-domain file when a single domain is selected in checkbox', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/mckanses-auth.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['mckanses-auth.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_DOMAIN)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      const q = (questions as { type: string; choices?: { value: unknown }[] }[])[0]
      if (q.type === 'checkbox') {
        const firstDomain = q.choices?.find((c) => (c.value as { kind?: string }).kind === 'domain')
        return Promise.resolve({ selected: firstDomain !== undefined ? [firstDomain.value] : [] })
      }
      return Promise.resolve({ confirm: true })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    const writeCall = (fs.writeFileSync as unknown as jest.Mock).mock.calls.find(
      (call) => normalizePath(String(call[0])).endsWith('mckanses-auth.yml')
    )
    expect(writeCall).toBeDefined()
    const content = typeof writeCall?.[1] === 'string' ? writeCall[1] : ''
    expect(content).not.toContain('mckanses-auth-1')
    expect(content).toContain('mckanses-auth-2')

    logSpy.mockRestore()
  })

  test('removes TLS certificate for domain when updating a multi-domain route file', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/multi-tls.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['multi-tls.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_WITH_TLS)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: unknown) => {
      const q = (questions as { type: string; choices?: { value: unknown }[] }[])[0]
      if (q.type === 'checkbox') {
        const firstDomain = q.choices?.find((c) => (c.value as { kind?: string }).kind === 'domain')
        return Promise.resolve({ selected: firstDomain !== undefined ? [firstDomain.value] : [] })
      }
      return Promise.resolve({ confirm: true })
    })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand()

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    const writeCall = (fs.writeFileSync as unknown as jest.Mock).mock.calls.find(
      (call) => normalizePath(String(call[0])).endsWith('multi-tls.yml')
    )
    expect(writeCall).toBeDefined()
    const content = typeof writeCall?.[1] === 'string' ? writeCall[1] : ''
    expect(content).not.toContain('app1.localhost.pem')
    expect(content).toContain('app2.localhost.pem')

    logSpy.mockRestore()
  })

  test('--all with multi-domain file calls unlinkSync once and removes hosts for all domains', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/mckanses-auth.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['mckanses-auth.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_DOMAIN)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirmAll: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand(undefined, { all: true })

    expect(fs.unlinkSync).toHaveBeenCalledTimes(1)
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mckanses-auth.yml'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✅ removed: ory-ui.mckansescloud.dev'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✅ removed: api.mckansescloud.dev'))

    logSpy.mockRestore()
  })

  test('removeProjectFile removes hosts entries when domain is no longer in any remaining route', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/mckanses-auth.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock)
      .mockReturnValueOnce(['mckanses-auth.yml'])
      .mockReturnValueOnce([])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(YAML_MULTI_DOMAIN)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('mckanses-auth', { all: true })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- removed domain: ory-ui.mckansescloud.dev'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- removed domain: api.mckansescloud.dev'))

    logSpy.mockRestore()
  })

  test('removes hosts entry automatically for .dev domains', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      return (
        np.endsWith('/.betty/docker-compose.yml') ||
        np.endsWith('/.betty/dynamic') ||
        np.endsWith('/.betty/dynamic/app.yml')
      )
    })
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['app.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation((p: unknown) => {
      const np = normalizePath(String(p))
      if (np.endsWith('/.betty/dynamic/app.yml')) return YAML_DEV_ROUTE
      if (np.includes('/drivers/etc/hosts') || np.endsWith('/etc/hosts')) return '127.0.0.1 ory-ui.mckanses-auth.dev # added by betty\n'
      return ''
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ confirm: true }))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await unlinkCommand('app')

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/hosts$/),
      expect.not.stringContaining('ory-ui.mckanses-auth.dev'),
      'utf8'
    )
    expect(logSpy).toHaveBeenCalledWith('Removed hosts entry for: ory-ui.mckanses-auth.dev')

    logSpy.mockRestore()
  })
})
