const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const commandLine = (name: string, description: string): string => {
  const label = name.padEnd(9, ' ')
  return `  ${label}${DIM}${description}${RESET}`
}

export function printHelp(): void {
  console.log('betty - local domains for docker')
  console.log('')
  console.log('Commands:')
  console.log(commandLine('serve', 'start local switchboard service'))
  console.log(commandLine('rest', 'stop local switchboard service'))
  console.log(commandLine('status', 'show switchboard status'))
  console.log(commandLine('link', 'connect a service to a domain'))
  console.log(commandLine('relink', 'update an existing domain link'))
  console.log(commandLine('unlink', 'remove a domain link'))
  console.log(commandLine('config', 'read or update betty settings'))
  console.log('')
  console.log('Examples:')
  console.log('  betty serve')
  console.log('  betty link myapp --domain myapp.dev --port 3000')
  console.log('  betty config set domainSuffix .localhost')
}