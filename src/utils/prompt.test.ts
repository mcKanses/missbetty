import inquirer from 'inquirer'
import { prompt } from './prompt'
import { BettyError } from './errors'

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}))

describe('prompt', () => {
  const stdinIsTTY = process.stdin.isTTY
  const setTTY = (value: boolean | undefined): void => { Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true }) }
  const question = [{ type: 'confirm', name: 'ok', message: 'Go?' }]

  beforeEach(() => { jest.clearAllMocks() })
  afterEach(() => { setTTY(stdinIsTTY) })

  test('asks through inquirer in a terminal', async () => {
    setTTY(true)
    ;(inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ ok: true })
    await expect(prompt(question)).resolves.toEqual({ ok: true })
    expect(inquirer.prompt).toHaveBeenCalledWith(question)
  })

  test.each([false, undefined])('fails cleanly without a terminal (isTTY %s)', async (value) => {
    setTTY(value)
    const result = prompt(question)
    await expect(result).rejects.toThrow(BettyError)
    await expect(result).rejects.toThrow('There is no terminal to answer the prompt.')
    expect(inquirer.prompt).not.toHaveBeenCalled()
  })
})
