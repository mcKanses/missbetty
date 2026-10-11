import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import inquirer from 'inquirer'
import setupCommand from './setup'
import { ensureHostsEntries } from '../utils/hosts'
import {
  checkMkcertCaInstalled,
  checkMkcertInstalled,
  collectSetupStatus,
  findMissingHostsEntries,
  installMkcertPackage,
  printDockerInstallInstructions,
  printMkcertInstallInstructions,
  runMkcertInstall,
} from '../utils/setup'

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

jest.mock('../utils/hosts', () => ({
  __esModule: true,
  ensureHostsEntries: jest.fn(),
}))

jest.mock('../utils/certs', () => ({
  checkAllCertificates: jest.fn(() => []),
  renewCertificates: jest.fn(() => []),
}))

jest.mock('../utils/docker', () => ({ restartTraefik: jest.fn() }))

jest.mock('../utils/lock', () => ({ withLock: (fn: () => unknown) => fn() }))

jest.mock('../utils/setup', () => ({
  __esModule: true,
  checkMkcertCaInstalled: jest.fn(),
  checkMkcertInstalled: jest.fn(),
  collectSetupStatus: jest.fn(),
  findMissingHostsEntries: jest.fn(),
  installMkcertPackage: jest.fn(),
  printDockerInstallInstructions: jest.fn(),
  printMkcertInstallInstructions: jest.fn(),
  runMkcertInstall: jest.fn(),
}))

describe('setup command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Unchanged since the status was collected, unless a test says otherwise.
    ;(findMissingHostsEntries as jest.Mock).mockImplementation(() =>
      ((collectSetupStatus as jest.Mock).mock.results.slice(-1)[0]?.value as { missingHostsEntries?: string[] } | undefined)?.missingHostsEntries ?? [])
  })

  test('installs mkcert automatically in --fix mode when missing', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: ['myapp.dev'],
    })
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })

    await setupCommand({ fix: true })

    expect(installMkcertPackage).toHaveBeenCalled()
    expect(runMkcertInstall).toHaveBeenCalled()
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(ensureHostsEntries).not.toHaveBeenCalled()
  })

  test('asks for mkcert install and CA setup in interactive mode', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: ['myapp.dev'],
    })
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true }))

    await setupCommand()

    expect(installMkcertPackage).toHaveBeenCalled()
    expect(inquirer.prompt).toHaveBeenCalledTimes(3)
    expect(runMkcertInstall).toHaveBeenCalled()
    expect(ensureHostsEntries).toHaveBeenCalledWith(['myapp.dev'])
  })

  test('adds the hosts entries missing when the prompt is answered, not when it was asked', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: true,
      hostsEntryExists: false,
      domain: 'old.dev',
      linkedDomains: ['old.dev'],
      missingHostsEntries: ['old.dev'],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })
    // old.dev was unlinked and new.dev linked while the prompt was open.
    ;(findMissingHostsEntries as jest.Mock).mockReturnValue(['new.dev'])
    jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand({ yes: true })

    expect(ensureHostsEntries).toHaveBeenCalledWith(['new.dev'])
  })

  test('prints installation instructions when automatic mkcert installation is declined', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: false,
      dockerRunning: false,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: false }))

    await setupCommand()

    expect(printMkcertInstallInstructions).toHaveBeenCalled()
    expect(printDockerInstallInstructions).toHaveBeenCalled()
  })

  test('prints warning and instructions in --fix mode when mkcert install fails', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: false, warning: 'brew failed' })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(false)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand({ fix: true })

    expect(printMkcertInstallInstructions).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('prints warning when mkcert install fails in interactive mode', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true }))
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: false, warning: 'install failed' })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(false)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand()

    expect(printMkcertInstallInstructions).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('--fix mode prints docker-not-running warning when docker installed but not running', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: false,
      mkcertInstalled: true,
      mkcertCaInstalled: true,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand({ fix: true })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'))
    logSpy.mockRestore()
  })

  test('--fix mode calls printDockerInstallInstructions when docker is not installed', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: false,
      dockerRunning: false,
      mkcertInstalled: true,
      mkcertCaInstalled: true,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)

    await setupCommand({ fix: true })

    expect(printDockerInstallInstructions).toHaveBeenCalled()
  })

  test('--fix mode logs runMkcertInstall warning when CA install fails', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: false, warning: 'CA failed' })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand({ fix: true })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('CA failed'))
    logSpy.mockRestore()
  })

  test('interactive mode adds the hosts entry through the shared hosts module when confirmed', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: true,
      hostsEntryExists: false,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: ['myapp.dev'],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true }))

    await setupCommand()

    expect(ensureHostsEntries).toHaveBeenCalledWith(['myapp.dev'])
  })

  test('interactive mode skips CA install when user declines', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: false }))

    await setupCommand()

    expect(runMkcertInstall).not.toHaveBeenCalled()
  })

  test('interactive mode skips hosts entry when user declines', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: true,
      hostsEntryExists: false,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: ['myapp.dev'],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: false }))

    await setupCommand()

    expect(ensureHostsEntries).not.toHaveBeenCalled()
  })

  test('interactive mode logs CA install warning when runMkcertInstall fails', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: false, warning: 'CA install failed' })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true }))
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('CA install failed'))
    logSpy.mockRestore()
  })

  test('--yes applies all fixes including hosts entry without prompting', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: ['myapp.dev'],
    })
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })

    await setupCommand({ yes: true })

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(installMkcertPackage).toHaveBeenCalled()
    expect(runMkcertInstall).toHaveBeenCalled()
    expect(ensureHostsEntries).toHaveBeenCalledWith(['myapp.dev'])
  })

  test('interactive mode logs docker-not-running when docker installed but not running', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: false,
      mkcertInstalled: true,
      mkcertCaInstalled: true,
      hostsEntryExists: true,
      domain: 'myapp.dev',
      linkedDomains: ['myapp.dev'],
      missingHostsEntries: [],
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(true)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await setupCommand()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'))
    logSpy.mockRestore()
  })
})