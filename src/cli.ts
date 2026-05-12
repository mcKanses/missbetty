#!/usr/bin/env node

import linkCommand from './commands/link'

import { Command } from 'commander'
import restCommand from './commands/rest'
import serveCommand from './commands/serve'
import relinkCommand from './commands/relink'
import statusCommand from './commands/status'
import unlinkCommand from './commands/unlink'
import configCommand from './commands/config'
import doctorCommand from './commands/doctor'
import setupCommand from './commands/setup'
import devCommand from './commands/dev'
import projectCommand, { projectCreateCommand, projectLoadCommand } from './commands/project'

import { printHelp } from './cli/ui/help'
import { animateBettyLogo, printBettyLogo } from './cli/ui/logo'
import { AUTHOR_INFO } from './cli/ui/meta'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../package.json') as { version: string }

interface StatusOptions {
  long?: boolean;
  json?: boolean;
  format?: string;
  short?: boolean;
}

interface RelinkOptions {
  container?: string;
  domain?: string;
  port?: string;
}

interface LinkOptions {
  domain?: string;
  port?: string;
  dryRun?: boolean;
  open?: boolean;
}

interface UnlinkOptions {
  domain?: string;
  all?: boolean;
  yes?: boolean;
}

interface SetupOptions {
  fix?: boolean;
}

interface DevOptions {
  config?: string;
  dryRun?: boolean;
}

interface ProjectLoadOptions {
  file?: string;
  dryRun?: boolean;
  yes?: boolean;
}

interface ProjectCreateOptions {
  name?: string;
}

export const createProgram = (): Command => {
  const program = new Command()

  program
    .name('betty')
    .description('Betty CLI - connects local domains to services')
    .version(`${version}\n${AUTHOR_INFO}`)
    .addHelpText('after', `\n${AUTHOR_INFO}`)

  const projectCmd = program
    .command('project')
    .description('Manage betty projects')
    .action(() => { void projectCommand() })

  projectCmd
    .command('load')
    .description('Load and start a project from .betty.yml')
    .option('--file <path>', 'Path to .betty.yml')
    .option('--dry-run', 'Preview configuration without applying changes')
    .option('-y, --yes', 'Accept all prompts automatically')
    .action((opts: ProjectLoadOptions) => { void projectLoadCommand(opts) })

  projectCmd
    .command('create')
    .description('Create a new .betty.yml interactively')
    .option('--name <name>', 'Project name')
    .action((opts: ProjectCreateOptions) => { void projectCreateCommand(opts) })

  program
    .command('dev')
    .description('Start a project from .betty.yml (use "betty project" instead)')
    .option('--config <path>', 'Path to .betty.yml')
    .option('--dry-run', 'Preview project configuration without applying changes')
    .option('-y, --yes', 'Accept all prompts automatically')
    .action((opts: DevOptions) => { void devCommand(opts) })

  program
    .command('serve')
    .description("Start Betty's local switchboard service")
    .action(serveCommand)

  program
    .command('stop')
    .description("Stop Betty's local switchboard service")
    .action(restCommand)

  program
    .command('rest')
    .description("Alias for 'stop'")
    .action(restCommand)

  program
    .command('status')
    .description("Show Betty's local switchboard status")
    .option('--long', 'Show detailed proxy container info')
    .option('--short', 'Show a compact linked-domain table')
    .option('--json', 'Output status as JSON')
    .option('--format <format>', 'Output format, e.g. json')
    .action((opts: StatusOptions) => { statusCommand(opts) })

  program
    .command('link [container]')
    .description('Link a running container to a local domain')
    .option('--domain <domain>', 'Target domain, e.g. my-app.localhost')
    .option('--port <port>', 'Internal container port')
    .option('--dry-run', 'Preview planned changes without applying them')
    .option('--open', 'Open the linked domain in the browser after linking')
    .action((container: string | undefined, opts: LinkOptions) => { void linkCommand(container, opts) })

  program
    .command('relink [target]')
    .description('Update an existing local domain link')
    .option('--container <container>', 'New target container')
    .option('--domain <domain>', 'New linked domain')
    .option('--port <port>', 'New internal container port')
    .action((target: string | undefined, opts: RelinkOptions) => { void relinkCommand(target, opts) })

  program
    .command('unlink [target]')
    .description('Remove a local domain link')
    .option('--domain <domain>', 'Linked domain, e.g. my-app.localhost')
    .option('--all', 'Remove all links at once')
    .option('-y, --yes', 'Skip interactive prompts and remove only the matched domain')
    .action((target: string | undefined, opts: UnlinkOptions) => { void unlinkCommand(target, opts) })

  program
    .command('config [action] [key] [value]')
    .description('Read or update Betty configuration')
    .action((action?: string, key?: string, value?: string) => { configCommand(action, key, value) })

  program
    .command('doctor')
    .description('Run read-only diagnostics for local Betty dependencies')
    .action(doctorCommand)

  program
    .command('setup')
    .description('Guide local dependency setup and safe repairs')
    .option('--fix', 'Apply safe automatic fixes without interactive confirmations')
    .action((opts: SetupOptions) => { void setupCommand(opts) })

  return program
}

export const run = async (argv = process.argv): Promise<void> => {
  const cmd = argv[2]

  if (!cmd) {
    await animateBettyLogo()
    console.log(`\n${AUTHOR_INFO}`)
    console.log('Run `betty help` to get started\n')
    process.exit(0)
  }

  if (cmd === 'help') {
    printBettyLogo()
    console.log('')
    printHelp()
    process.exit(0)
  }

  const program = createProgram()
  program.parse(argv)
}

if (require.main === module) void run()
