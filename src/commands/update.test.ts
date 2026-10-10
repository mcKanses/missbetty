import inquirer from 'inquirer'
import updateCommand from './update'
import { fetchLatestVersion, installUpdate } from '../utils/update'

jest.mock('inquirer', () => ({ prompt: jest.fn() }))
jest.mock('../utils/update', () => ({
  ...jest.requireActual<object>('../utils/update'),
  fetchLatestVersion: jest.fn(),
  installUpdate: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: current } = require('../../package.json') as { version: string }
const [major, minor] = current.split('.').map(Number)
const next = `${String(major)}.${String(minor + 1)}.0`

describe('update command', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => { logSpy.mockRestore() })

  const output = (): string => logSpy.mock.calls.map((c) => String(c[0])).join('\n')

  test('reports when betty is up to date', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue(current)
    await updateCommand()
    expect(output()).toContain(`up to date (${current})`)
    expect(installUpdate).not.toHaveBeenCalled()
  })

  test('fails clearly when GitHub cannot be reached', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue(null)
    await expect(updateCommand()).rejects.toThrow('Could not reach GitHub')
  })

  test('--check only reports a newer version', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue(next)
    await updateCommand({ check: true })
    expect(output()).toContain(`Betty ${next} is available`)
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(installUpdate).not.toHaveBeenCalled()
  })

  test('asks before installing and respects a no', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue(next)
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ install: false })
    await updateCommand()
    expect(inquirer.prompt).toHaveBeenCalled()
    expect(installUpdate).not.toHaveBeenCalled()
  })

  test('--yes installs without asking', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue(next)
    await updateCommand({ yes: true })
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(installUpdate).toHaveBeenCalledWith(next)
    expect(output()).toContain(`updated to ${next}`)
  })
})
