import fs from 'fs'
import path from 'path'
import yaml from 'yaml'
import inquirer from 'inquirer'
import { printError } from '../cli/ui/output'
import devCommand, { resolveConfigPath, readDevProjectConfig, runProjectCommand, linkProject, printUrls } from './dev'
import unlinkCommand from './unlink'
import { readRoutes } from '../utils/routes'
import { sanitizeName } from '../utils/names'

interface ProjectCreateOptions {
  name?: string;
}

interface ProjectLoadOptions {
  file?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export const validateHttpTarget = (value: string): true | string => {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Must be an http(s) URL.'
    return true
  } catch {
    return 'Must be a valid http(s) URL.'
  }
}

const writeBettyYml = (configPath: string, config: Record<string, unknown>): void => {
  fs.writeFileSync(configPath, yaml.stringify(config), 'utf8')
}

export const projectCreateCommand = async (opts: ProjectCreateOptions): Promise<void> => {
  const configPath = path.resolve(process.cwd(), '.betty.yml')

  if (fs.existsSync(configPath)) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: '.betty.yml already exists. Overwrite it?',
      default: false,
    }]) as { overwrite: boolean }
    if (!overwrite) { console.log('Cancelled.'); return }
  }

  const { projectName } = await inquirer.prompt([{
    type: 'input',
    name: 'projectName',
    message: 'Project name:',
    default: opts.name?.trim() ?? path.basename(process.cwd()),
    validate: (v: string) => v.trim() !== '' || 'Project name is required.',
  }]) as { projectName: string }

  const domains: { host: string; target: string }[] = []
  let addingDomains = true
  while (addingDomains) {
    const idx = domains.length + 1
    const { host, target } = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: `Domain ${String(idx)} host (e.g. my-app.localhost):`,
        validate: (v: string) => v.trim() !== '' || 'Host is required.',
      },
      {
        type: 'input',
        name: 'target',
        message: `Domain ${String(idx)} target URL (e.g. http://127.0.0.1:3000):`,
        validate: validateHttpTarget,
      },
    ]) as { host: string; target: string }
    domains.push({ host: host.trim(), target: target.trim() })

    const { another } = await inquirer.prompt([{
      type: 'confirm',
      name: 'another',
      message: 'Add another domain?',
      default: false,
    }]) as { another: boolean }
    addingDomains = another
  }

  const { httpsEnabled, upCommand, downCommand, autoApprove } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'httpsEnabled',
      message: 'Enable HTTPS (requires mkcert)?',
      default: false,
    },
    {
      type: 'input',
      name: 'upCommand',
      message: 'Start command (optional, e.g. docker compose up -d):',
    },
    {
      type: 'input',
      name: 'downCommand',
      message: 'Stop command (optional, e.g. docker compose down):',
    },
    {
      type: 'confirm',
      name: 'autoApprove',
      message: 'Auto-approve all system prompts (hosts, Docker, mkcert)?',
      default: true,
    },
  ]) as { httpsEnabled: boolean; upCommand: string; downCommand: string; autoApprove: boolean }

  const config: Record<string, unknown> = { project: projectName.trim() }
  if (upCommand.trim()) config.up = { command: upCommand.trim() }
  if (downCommand.trim()) config.down = { command: downCommand.trim() }
  config.domains = domains
  if (httpsEnabled) config.https = { enabled: true, certificateAuthority: 'missbetty' }
  if (autoApprove) config.permissions = { hosts: 'allowed', trustStore: 'allowed', docker: 'allowed' }

  writeBettyYml(configPath, config)
  console.log('\n✅ Created .betty.yml')

  const { startNow } = await inquirer.prompt([{
    type: 'confirm',
    name: 'startNow',
    message: 'Start the project now?',
    default: true,
  }]) as { startNow: boolean }
  if (startNow) await devCommand({ config: configPath, yes: true })
}

export const projectLoadCommand = async (opts: ProjectLoadOptions): Promise<void> => {
  try {
    if (opts.yes !== true && opts.dryRun !== true) {
      const configPath = resolveConfigPath(opts.file)
      const config = readDevProjectConfig(configPath)
      const relPath = path.relative(process.cwd(), configPath) || path.basename(configPath)
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Load project '${config.project}' from ${relPath}?`,
        default: true,
      }]) as { confirm: boolean }
      if (!confirm) { console.log('Cancelled.'); return }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  await devCommand({ config: opts.file, dryRun: opts.dryRun, yes: opts.yes })
}

interface ProjectActionOptions {
  file?: string;
  yes?: boolean;
}

export const projectLinkCommand = async (opts: ProjectActionOptions): Promise<void> => {
  try {
    const configPath = resolveConfigPath(opts.file)
    const config = readDevProjectConfig(configPath)

    if (opts.yes !== true && opts.file === undefined) {
      const relPath = path.relative(process.cwd(), configPath) || path.basename(configPath)
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Link project '${config.project}' from ${relPath}?`,
        default: true,
      }]) as { confirm: boolean }
      if (!confirm) { console.log('Cancelled.'); return }
    }

    await linkProject(config, { yes: opts.yes })
    printUrls(config)
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

export const projectStopCommand = async (opts: ProjectActionOptions): Promise<void> => {
  try {
    const configPath = resolveConfigPath(opts.file)
    const config = readDevProjectConfig(configPath)

    if (opts.yes !== true) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Stop project '${config.project}'?`,
        default: false,
      }]) as { confirm: boolean }
      if (!confirm) { console.log('Cancelled.'); return }
    }

    if (config.down?.command !== undefined) {
      console.log(`Running: ${config.down.command}`)
      runProjectCommand(config.down.command, configPath)
    }

    await unlinkCommand({ project: sanitizeName(config.project), yes: true })
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

const printStatusTable = (rows: { status: string; domain: string; target: string }[], projectName: string): void => {
  const statusW = Math.max(8, ...rows.map((r) => r.status.length))
  const domainW = Math.max(6, ...rows.map((r) => r.domain.length))
  const targetW = Math.max(6, ...rows.map((r) => r.target.length))
  const header = `${'status'.padEnd(statusW)} | ${'domain'.padEnd(domainW)} | ${'target'.padEnd(targetW)}`
  const sep = `${'-'.repeat(statusW)}-|-${'-'.repeat(domainW)}-|-${'-'.repeat(targetW)}`
  console.log(`\nproject name: ${projectName}\n`)
  console.log(header)
  console.log(sep)
  rows.forEach((r) => {
    console.log(`${r.status.padEnd(statusW)} | ${r.domain.padEnd(domainW)} | ${r.target.padEnd(targetW)}`)
  })
}

export const projectStatusCommand = async (opts: { file?: string; name?: string }): Promise<void> => {
  try {
    const routes = readRoutes()

    if (opts.name !== undefined) {
      const projectName = opts.name.trim()
      const projectRoutes = routes.filter(
        (r) => path.basename(r.fileName, path.extname(r.fileName)) === sanitizeName(projectName)
      )
      if (projectRoutes.length === 0) {
        printError(`No linked project found with name '${projectName}'.`)
        process.exit(1)
      }
      printStatusTable(
        projectRoutes.map((r) => ({ status: 'linked', domain: r.domain, target: r.target })),
        projectName
      )
      return
    }

    let configPath: string
    if (opts.file === undefined) try {
        configPath = resolveConfigPath(undefined)
        const foundConfig = readDevProjectConfig(configPath)
        const relPath = path.relative(process.cwd(), configPath) || path.basename(configPath)
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Found project '${foundConfig.project}' in ${relPath}. Show status?`,
          default: true,
        }]) as { confirm: boolean }
        if (!confirm) { console.log('Cancelled.'); return }
      } catch {
        console.log('\nNo project specified. Use --file <path> or --name <name> to target a specific project.')
        return
      }
     else configPath = resolveConfigPath(opts.file)
    

    const config = readDevProjectConfig(configPath)
    printStatusTable(
      config.domains.map((d) => ({
        status: routes.some((r) => r.domain.toLowerCase() === d.host.toLowerCase()) ? 'linked' : 'unlinked',
        domain: d.host,
        target: d.target,
      })),
      config.project
    )
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

