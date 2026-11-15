import inquirer from 'inquirer'
import { BettyError } from './errors'

// Without a terminal (CI, a script, piped input) a prompt cannot be answered:
// inquirer crashes once stdin ends and waits forever on a pipe left open.
// Commands ask through this instead, so both turn into a clean error.
export const prompt = async <T extends inquirer.Answers = inquirer.Answers>(
  questions: inquirer.QuestionCollection<T>,
): Promise<T> => {
  if (!process.stdin.isTTY) throw new BettyError('There is no terminal to answer the prompt.', {
    hints: ['Run the command in a terminal, or pass --yes where it is supported to accept the prompts up front.'],
  })
  return inquirer.prompt<T>(questions)
}
