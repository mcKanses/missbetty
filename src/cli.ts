import linkCommand from './commands/link';

import { Command } from 'commander';
import restCommand from './commands/rest';
import serveCommand from './commands/serve';
import relinkCommand from './commands/relink';
import statusCommand from './commands/status';
import unlinkCommand from './commands/unlink';

const program = new Command();

program
  .name('betty')
  .description('Betty CLI - switch local domains for Docker projects')
  .version('0.1.0')

program
  .command('serve')
  .description("Start Betty's local switchboard service")
  .action(serveCommand)

program
  .command('rest')
  .description("Stop Betty's local switchboard service")
  .action(restCommand)

program
  .command('status')
  .description("Show Betty's local switchboard status")
  .option('--long', 'Show detailed proxy container info')
  .option('--json', 'Output status as JSON')
  .option('--format <format>', 'Output format, e.g. json')
  .action((opts) => statusCommand(opts))

program
  .command('link [container]')
  .description('Link a running container to a local domain')
  .option('--domain <domain>', 'Target domain, e.g. testapp.localhost')
  .option('--port <port>', 'Internal container port')
  .action((container, opts) => linkCommand(container, opts))

program
  .command('relink [target]')
  .description('Update an existing local domain link')
  .option('--container <container>', 'New target container')
  .option('--domain <domain>', 'New linked domain')
  .option('--port <port>', 'New internal container port')
  .action((target, opts) => relinkCommand(target, opts))

program
  .command('unlink [target]')
  .description('Remove a local domain link')
  .option('--domain <domain>', 'Linked domain, e.g. testapp.localhost')
  .action((target, opts) => unlinkCommand(target, opts))

program.parse(process.argv);
