const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

import { AUTHOR_INFO } from './meta'

// Describes one top-level command in the help listing. Callers derive this from
// the Commander program so the help text has a single source of truth and cannot
// silently drift from the registered commands.
export interface HelpCommand {
  name: string;
  description: string;
}

const commandLine = (name: string, description: string): string => {
  const label = name.padEnd(9, ' ')
  return `  ${label}${DIM}${description}${RESET}`
}

export const printHelp = (commands: HelpCommand[]): void => {
  const title = 'betty - connects local domains to services'
  const author = AUTHOR_INFO
  const pad = Math.max(0, 60 - title.length - author.length)
  const right = pad > 0 ? ' '.repeat(pad) : ' '
  console.log(title + right + author)
  console.log('')
  console.log('Commands:')
  for (const { name, description } of commands) console.log(commandLine(name, description))
  console.log('')
  console.log('Examples:')
  console.log('  betty project load')
  console.log('  betty project create')
  console.log('  betty project status --name my-app')
  console.log('  betty serve')
  console.log('  betty link myapp --domain myapp.localhost --port 3000')
  console.log('  betty status --short')
  console.log('  betty doctor')
  console.log('  betty setup --fix')
  console.log('  betty config set domainSuffix .localhost')
  console.log('')
}
