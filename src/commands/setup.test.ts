import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import inquirer from 'inquirer'
import setupCommand from './setup'
import {
  addHostsEntry,
  checkMkcertCaInstalled,
  checkMkcertInstalled,
  collectSetupStatus,
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

jest.mock('../utils/setup', () => ({
  __esModule: true,
  addHostsEntry: jest.fn(),
  checkMkcertCaInstalled: jest.fn(),
  checkMkcertInstalled: jest.fn(),
  collectSetupStatus: jest.fn(),
  installMkcertPackage: jest.fn(),
  printDockerInstallInstructions: jest.fn(),
  printMkcertInstallInstructions: jest.fn(),
  runMkcertInstall: jest.fn(),
}))

describe('setup command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('installs mkcert automatically in --fix mode when missing', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
    })
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })

    await setupCommand({ fix: true })

    expect(installMkcertPackage).toHaveBeenCalled()
    expect(runMkcertInstall).toHaveBeenCalled()
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(addHostsEntry).not.toHaveBeenCalled()
  })

  test('asks for mkcert install and CA setup in interactive mode', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
    })
    ;(installMkcertPackage as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(checkMkcertCaInstalled as unknown as jest.Mock).mockReturnValue(false)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(addHostsEntry as unknown as jest.Mock).mockReturnValue({ changed: true })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true }))

    await setupCommand()

    expect(installMkcertPackage).toHaveBeenCalled()
    expect(inquirer.prompt).toHaveBeenCalledTimes(3)
    expect(runMkcertInstall).toHaveBeenCalled()
    expect(addHostsEntry).toHaveBeenCalledWith('myapp.dev')
  })

  test('prints installation instructions when automatic mkcert installation is declined', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: false,
      dockerRunning: false,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
    })
    ;(checkMkcertInstalled as unknown as jest.Mock)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: false }))

    await setupCommand()

    expect(printMkcertInstallInstructions).toHaveBeenCalled()
    expect(printDockerInstallInstructions).toHaveBeenCalled()
  })
})