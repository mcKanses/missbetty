import { describe, expect, test, beforeEach, jest } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import path from 'path'
import restCommand from './rest'

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
  },
  existsSync: jest.fn(),
}))

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
  prompt: jest.fn(),
}))

describe('rest command', () => {
  const composePath = path.join('/home/test-user', '.betty', 'docker-compose.yml')
  const homeDir = path.join('/home/test-user', '.betty')

  beforeEach(() => {
    jest.clearAllMocks()
    ;(process.exit as unknown as jest.Mock) = jest.fn().mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })
  })

  test('prints setup hint when Betty proxy is not set up yet', async () => {
    (fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await restCommand()

    expect(fs.existsSync).toHaveBeenCalledWith(composePath)
    expect(execSync).not.toHaveBeenCalled()
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith("Betty's local switchboard service is not set up yet.")
    expect(logSpy).toHaveBeenCalledWith('Start it with: betty serve')

    logSpy.mockRestore()
  })

  test('shows confirmation prompt and cancels on decline', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValueOnce({ confirm: false } as never)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await restCommand()

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'confirm', type: 'confirm' })])
    )
    expect(execSync).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Cancelled.')

    logSpy.mockRestore()
  })

  test('runs docker compose down when user confirms', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValueOnce({ confirm: true } as never)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await restCommand()

    expect(execSync).toHaveBeenCalledWith(`docker compose -f "${composePath}" down`, {
      cwd: homeDir,
      stdio: 'inherit',
    })
    expect(logSpy).toHaveBeenCalledWith('Betty is resting.')

    logSpy.mockRestore()
  })

  test('skips prompt and runs docker compose down when --yes is passed', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await restCommand({ yes: true })

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(execSync).toHaveBeenCalledWith(`docker compose -f "${composePath}" down`, {
      cwd: homeDir,
      stdio: 'inherit',
    })
    expect(logSpy).toHaveBeenCalledWith('Betty is resting.')

    logSpy.mockRestore()
  })

  test('prints error and exits with code 1 when stopping fails', async () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(execSync as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('compose down failed')
    })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(restCommand({ yes: true })).rejects.toThrow('process-exit-1')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Betty's switchboard service could not be stopped: compose down failed")
    )

    errorSpy.mockRestore()
  })
})
