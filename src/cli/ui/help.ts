const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

import { AUTHOR_INFO } from './meta'

const commandLine = (name: string, description: string): string => {
  const label = name.padEnd(9, ' ')
  return `  ${label}${DIM}${description}${RESET}`
}

export function printHelp(): void {
  // Name und Links rechtsbündig anzeigen
  const title = 'betty - connects local domains to services'
  const author = AUTHOR_INFO
  const pad = Math.max(0, 60 - title.length - author.length)
  const right = pad > 0 ? ' '.repeat(pad) : ' '
  console.log(title + right + author)
  console.log('')
  console.log('Commands:')
  console.log(commandLine('serve', 'start local switchboard service'))
  console.log(commandLine('stop', 'stop local switchboard service'))
  console.log(commandLine('rest', "alias for 'stop'"))
  console.log(commandLine('status', 'show switchboard status'))
  console.log(commandLine('link', 'connect a service to a domain'))
  console.log(commandLine('relink', 'update an existing domain link'))
  console.log(commandLine('unlink', 'remove a domain link'))
  console.log(commandLine('config', 'read or update betty settings'))
  console.log(commandLine('doctor', 'run dependency diagnostics'))
  console.log(commandLine('setup', 'interactive setup and repair'))
  console.log('')
  console.log('Examples:')
  console.log('  betty serve')
  console.log('  betty link myapp --domain myapp.localhost --port 3000')
  console.log('  betty status --short')
  console.log('  betty doctor')
  console.log('  betty setup --fix')
  console.log('  betty config set domainSuffix .localhost')
  console.log('')
}
