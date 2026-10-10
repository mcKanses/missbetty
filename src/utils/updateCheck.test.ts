import fs from 'fs'
import inquirer from 'inquirer'
import { getUpdateCheck } from './config'
import { fetchLatestVersion, installUpdate } from './update'
import { offerUpdate, updateCheckApplies } from './updateCheck'

jest.mock('inquirer', () => ({ prompt: jest.fn() }))
jest.mock('./config', () => ({ getUpdateCheck: jest.fn(() => true) }))
jest.mock('./constants', () => ({ BETTY_HOME_DIR: '/home/test-user/.betty' }))
jest.mock('./update', () => ({
  ...jest.requireActual<object>('./update'),
  fetchLatestVersion: jest.fn(),
  installUpdate: jest.fn(),
}))
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

const HOUR = 60 * 60_000
const argv = (...args: string[]): string[] => ['node', 'betty', ...args]
const savedState = (): Record<string, unknown> => {
  const calls = (fs.writeFileSync as jest.Mock).mock.calls
  return JSON.parse(String(calls[calls.length - 1][1])) as Record<string, unknown>
}
const setState = (state: object | null): void => {
  ;(fs.readFileSync as jest.Mock).mockImplementation(() => {
    if (state === null) throw new Error('ENOENT')
    return JSON.stringify(state)
  })
}

describe('update check', () => {
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }
  const ci = process.env.CI
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getUpdateCheck as jest.Mock).mockReturnValue(true)
    process.stdin.isTTY = true
    process.stdout.isTTY = true
    delete process.env.CI
    setState(null)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => {
    process.stdin.isTTY = tty.stdin
    process.stdout.isTTY = tty.stdout
    if (ci !== undefined) process.env.CI = ci
    logSpy.mockRestore()
  })

  test('applies only to interactive runs that print for humans', () => {
    expect(updateCheckApplies(argv('link', 'web'))).toBe(true)
    expect(updateCheckApplies(argv('status', '--json'))).toBe(false)
    expect(updateCheckApplies(argv('status', '--format=json'))).toBe(false)
    expect(updateCheckApplies(argv('update'))).toBe(false)
    expect(updateCheckApplies(argv('--version'))).toBe(false)

    process.env.CI = 'true'
    expect(updateCheckApplies(argv('link'))).toBe(false)
    delete process.env.CI

    process.stdout.isTTY = false
    expect(updateCheckApplies(argv('link'))).toBe(false)
    process.stdout.isTTY = true

    ;(getUpdateCheck as jest.Mock).mockReturnValue(false)
    expect(updateCheckApplies(argv('link'))).toBe(false)
  })

  test('offers a newer release and installs it when accepted', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ choice: 'install' })

    await offerUpdate(argv('status'), '1.9.1')

    expect(installUpdate).toHaveBeenCalledWith('1.10.0')
    expect(savedState()).toEqual(expect.objectContaining({ latest: '1.10.0', askedAt: expect.any(Number) as number }))
  })

  test('says nothing when betty is current', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.9.1')
    await offerUpdate(argv('status'), '1.9.1')
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })

  test('looks up the release at most once a day', async () => {
    setState({ checkedAt: Date.now() - HOUR, latest: '1.9.1' })
    await offerUpdate(argv('status'), '1.9.1')
    expect(fetchLatestVersion).not.toHaveBeenCalled()
  })

  test('asks at most once a day, whatever the answer', async () => {
    setState({ checkedAt: Date.now() - HOUR, latest: '1.10.0', askedAt: Date.now() - HOUR })
    await offerUpdate(argv('status'), '1.9.1')
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })

  test('never offers a skipped version again', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ choice: 'skip' })
    await offerUpdate(argv('status'), '1.9.1')
    expect(savedState()).toEqual(expect.objectContaining({ skipped: '1.10.0' }))
    expect(installUpdate).not.toHaveBeenCalled()

    setState({ checkedAt: Date.now() - HOUR, latest: '1.10.0', skipped: '1.10.0', askedAt: Date.now() - 2 * 24 * HOUR })
    ;(inquirer.prompt as unknown as jest.Mock).mockClear()
    await offerUpdate(argv('status'), '1.9.1')
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })

  test('stays quiet when the lookup fails, and waits a day before the next one', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue(null)
    await offerUpdate(argv('status'), '1.9.1')
    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(savedState()).toEqual({ checkedAt: expect.any(Number) as number })

    setState(savedState())
    ;(fetchLatestVersion as jest.Mock).mockClear()
    await offerUpdate(argv('status'), '1.9.1')
    expect(fetchLatestVersion).not.toHaveBeenCalled()
  })

  test('does not ask in scripts that pass --yes', () => {
    expect(updateCheckApplies(argv('link', 'web', '-y'))).toBe(false)
    expect(updateCheckApplies(argv('unlink', '--all', '--yes'))).toBe(false)
  })

  test('a cancelled prompt counts as asked', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')
    ;(inquirer.prompt as unknown as jest.Mock).mockRejectedValue(new Error('User force closed the prompt'))

    await expect(offerUpdate(argv('status'), '1.9.1')).rejects.toThrow('force closed')
    expect(savedState()).toEqual(expect.objectContaining({ askedAt: expect.any(Number) as number }))
  })

  test('the state file is replaced atomically', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.9.1')
    await offerUpdate(argv('status'), '1.9.1')
    const tmp = String((fs.writeFileSync as jest.Mock).mock.calls[0][0])
    expect(tmp).toMatch(/update-check\.json\.\d+\.tmp$/)
    expect(fs.renameSync).toHaveBeenCalledWith(tmp, expect.stringMatching(/update-check\.json$/))
  })
})
