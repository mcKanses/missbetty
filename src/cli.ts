import { Command } from 'commander'
import initCommand from './commands/init'
import proxyUpCommand from './commands/proxyUp'
import upCommand from './commands/up'

const program = new Command()

program
  .name('betty')
  .description('Betty CLI – Cross-Platform Dev Domains mit Docker Compose & Traefik')
  .version('0.1.0')

program
  .command('init')
  .description('Projekt für Betty initialisieren')
  .action(initCommand)

program
  .command('proxy up')
  .description('Globalen Traefik-Proxy starten')
  .action(proxyUpCommand)

program
  .command('up')
  .description('Projekt inkl. Routing starten')
  .action(upCommand)

program.parse(process.argv)
