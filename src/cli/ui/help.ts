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
  console.log(commandLine('link', 'connect a service to a domain'))
  console.log(commandLine('up', 'start project services'))
  console.log(commandLine('proxy up', 'start global proxy'))
  console.log(commandLine('doctor', 'diagnose issues'))
  console.log('')
  console.log('Examples:')
  console.log('  betty link')
  console.log('  betty up')
}