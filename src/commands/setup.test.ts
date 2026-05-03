import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import inquirer from 'inquirer'
import setupCommand from './setup'
import {
  addHostsEntry,
  checkMkcertInstalled,
  collectSetupStatus,
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
  checkMkcertInstalled: jest.fn(),
  collectSetupStatus: jest.fn(),
  printDockerInstallInstructions: jest.fn(),
  printMkcertInstallInstructions: jest.fn(),
  runMkcertInstall: jest.fn(),
}))

describe('setup command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('runs safe fixes only in --fix mode', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
    })
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })

    await setupCommand({ fix: true })

    expect(runMkcertInstall).toHaveBeenCalled()
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(addHostsEntry).not.toHaveBeenCalled()
  })

  test('asks for confirmation in interactive mode and applies selected fixes', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: true,
      dockerRunning: true,
      mkcertInstalled: true,
      mkcertCaInstalled: false,
      hostsEntryExists: false,
      domain: 'myapp.dev',
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(true)
    ;(runMkcertInstall as unknown as jest.Mock).mockReturnValue({ ok: true })
    ;(addHostsEntry as unknown as jest.Mock).mockReturnValue({ changed: true })
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true }))

    await setupCommand()

    expect(inquirer.prompt).toHaveBeenCalledTimes(2)
    expect(runMkcertInstall).toHaveBeenCalled()
    expect(addHostsEntry).toHaveBeenCalledWith('myapp.dev')
  })

  test('prints installation instructions when dependencies are missing', async () => {
    ;(collectSetupStatus as unknown as jest.Mock).mockReturnValue({
      dockerInstalled: false,
      dockerRunning: false,
      mkcertInstalled: false,
      mkcertCaInstalled: false,
      hostsEntryExists: true,
      domain: 'myapp.dev',
    })
    ;(checkMkcertInstalled as unknown as jest.Mock).mockReturnValue(false)

    await setupCommand()

    expect(printMkcertInstallInstructions).toHaveBeenCalled()
    expect(printDockerInstallInstructions).toHaveBeenCalled()
  })
})