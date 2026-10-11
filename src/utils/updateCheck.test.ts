import { EventEmitter } from 'events'
import fs from 'fs'
import inquirer from 'inquirer'
import { getUpdateCheck } from './config'
import { fetchLatestVersion, installMethod, installUpdate, updateRoute } from './update'
import { offerUpdate, updateCheckApplies } from './updateCheck'

jest.mock('inquirer', () => ({ prompt: jest.fn() }))
jest.mock('./config', () => ({ getUpdateCheck: jest.fn(() => true) }))
jest.mock('./constants', () => ({ BETTY_HOME_DIR: '/home/test-user/.betty' }))
jest.mock('./update', () => ({
  ...jest.requireActual<object>('./update'),
  fetchLatestVersion: jest.fn(),
  installUpdate: jest.fn(),
  installMethod: jest.fn(() => 'binary'),
  updateRoute: jest.fn(() => Promise.resolve({ by: 'betty' })),
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
    ;(installMethod as jest.Mock).mockReturnValue('binary')
    ;(updateRoute as jest.Mock).mockResolvedValue({ by: 'betty' })
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

  test('while npm lags the release, says nothing and asks the registry again tomorrow', async () => {
    ;(updateRoute as jest.Mock).mockResolvedValue({ by: 'later' })
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')

    await offerUpdate(argv('status'), '1.9.1')

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(savedState().askedAt).toEqual(expect.any(Number))

    setState(savedState())
    ;(updateRoute as jest.Mock).mockClear()
    await offerUpdate(argv('status'), '1.9.1')
    expect(updateRoute).not.toHaveBeenCalled()
  })

  test('only shows the command for installs betty cannot update itself', async () => {
    ;(updateRoute as jest.Mock).mockResolvedValue({ by: 'hand', command: 'pnpm add -g missbetty@1.10.0' })
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')

    await offerUpdate(argv('status'), '1.9.1')

    expect(inquirer.prompt).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Update with: pnpm add -g missbetty@1.10.0')
  })

  test('says nothing to npx runs', async () => {
    ;(installMethod as jest.Mock).mockReturnValue('npx')
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')

    await offerUpdate(argv('status'), '1.9.1')

    expect(logSpy).not.toHaveBeenCalled()
    expect(updateRoute).not.toHaveBeenCalled()
  })

  test('Ctrl+C at the prompt closes it and ends with exit code 0, since the command succeeded', async () => {
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')
    // inquirer 8 handles Ctrl+C on its readline with onForceClose, which
    // signals the process: on Windows that ends it with exit code 1.
    const rl = new EventEmitter()
    const ui = { rl, onForceClose: jest.fn(), close: jest.fn() }
    rl.on('SIGINT', ui.onForceClose)
    ;(inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      setImmediate(() => rl.emit('SIGINT'))
      return Object.assign(new Promise(() => undefined), { ui })
    })
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${String(code)}`) })
    const exited = new Promise<unknown>((resolve) => {
      exitSpy.mockImplementation((code) => { resolve(code); return undefined as never })
    })

    void offerUpdate(argv('status'), '1.9.1')

    await expect(exited).resolves.toBe(0)
    expect(ui.onForceClose).not.toHaveBeenCalled()
    expect(ui.close).toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  test('a time in the future does not silence the check', async () => {
    setState({ checkedAt: Date.now() + 30 * 24 * HOUR, latest: '1.9.1', askedAt: Date.now() + 30 * 24 * HOUR })
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.10.0')
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ choice: 'later' })

    await offerUpdate(argv('status'), '1.9.1')

    expect(fetchLatestVersion).toHaveBeenCalled()
    expect(inquirer.prompt).toHaveBeenCalled()
  })

  test('starts over from a malformed state file', async () => {
    setState(null)
    ;(fs.readFileSync as jest.Mock).mockReturnValue('null')
    ;(fetchLatestVersion as jest.Mock).mockResolvedValue('1.9.1')

    await expect(offerUpdate(argv('status'), '1.9.1')).resolves.toBeUndefined()
    expect(savedState()).toEqual({ checkedAt: expect.any(Number) as number, latest: '1.9.1' })
  })
})
