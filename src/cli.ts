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
import { projectCreateCommand, projectLoadCommand, projectLinkCommand, projectStopCommand, projectStatusCommand } from './commands/project'

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
  yes?: boolean;
}

interface LinkOptions {
  domain?: string;
  port?: string;
  dryRun?: boolean;
  open?: boolean;
  yes?: boolean;
}

interface ProjectActionOptions {
  file?: string;
  yes?: boolean;
}

interface UnlinkOptions {
  domain?: string;
  project?: string;
  all?: boolean;
  yes?: boolean;
}

interface SetupOptions {
  fix?: boolean;
  yes?: boolean;
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
    .version(`\n${version}\n\n${AUTHOR_INFO}\n`)
    .addHelpText('after', `\n${AUTHOR_INFO}\n`)

  const projectCmd = program
    .command('project')
    .description('Manage betty projects')

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

  projectCmd
    .command('unlink <name>')
    .description('Remove all domain links for a project')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((name: string, opts: { yes?: boolean }) => { void unlinkCommand({ project: name, yes: opts.yes }) })

  projectCmd
    .command('link')
    .description('Link project domains without starting services')
    .option('--file <path>', 'Path to .betty.yml')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action((opts: ProjectActionOptions) => { void projectLinkCommand(opts) })

  projectCmd
    .command('stop')
    .description('Run down command and remove domain links')
    .option('--file <path>', 'Path to .betty.yml')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts: ProjectActionOptions) => { void projectStopCommand(opts) })

  projectCmd
    .command('status')
    .description('Show linked status for project domains')
    .option('--file <path>', 'Path to .betty.yml')
    .action((opts: { file?: string }) => { void projectStatusCommand(opts) })

  projectCmd
    .command('serve')
    .description("Start Betty's local switchboard service")
    .action(serveCommand)

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
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts: { yes?: boolean }) => { void restCommand(opts) })

  program
    .command('rest')
    .description("Alias for 'stop'")
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts: { yes?: boolean }) => { void restCommand(opts) })

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
    .option('-y, --yes', 'Auto-select first available port, skip prompts')
    .action((container: string | undefined, opts: LinkOptions) => { void linkCommand(container, opts) })

  program
    .command('relink [target]')
    .description('Update an existing local domain link')
    .option('--container <container>', 'New target container')
    .option('--domain <domain>', 'New linked domain')
    .option('--port <port>', 'New internal container port')
    .option('-y, --yes', 'Keep current values without prompting')
    .action((target: string | undefined, opts: RelinkOptions) => { void relinkCommand(target, opts) })

  program
    .command('unlink')
    .description('Remove a local domain link')
    .option('--domain <domain>', 'Linked domain, e.g. my-app.localhost')
    .option('--project <name>', 'Project name to unlink all domains for')
    .option('--all', 'Remove all links at once')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts: UnlinkOptions) => { void unlinkCommand(opts) })

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
    .option('-y, --yes', 'Auto-confirm all prompts')
    .action((opts: SetupOptions) => { void setupCommand(opts) })

  return program
}

export const run = async (argv = process.argv): Promise<void> => {
  const cmd = argv[2]

  if (!cmd) {
    await animateBettyLogo()
    console.log(`\n${AUTHOR_INFO}\n`)
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

// if (require.main === module) void run()
