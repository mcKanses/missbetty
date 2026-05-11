import fs from 'fs'
import path from 'path'
import yaml from 'yaml'
import inquirer from 'inquirer'
import { printError } from '../cli/ui/output'
import devCommand from './dev'

interface ProjectCreateOptions {
  name?: string;
}

interface ProjectLoadOptions {
  file?: string;
  dryRun?: boolean;
  yes?: boolean;
}

const validateHttpTarget = (value: string): true | string => {
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
  await devCommand({ config: opts.file, dryRun: opts.dryRun, yes: opts.yes })
}

const findBettyYml = (): string | undefined => {
  const candidates = ['.betty.yml', '.betty.yaml', '.missbetty.yml', '.missbetty.yaml']
  return candidates.find((c) => fs.existsSync(path.resolve(process.cwd(), c)))
}

const projectCommand = async (): Promise<void> => {
  try {
    const found = findBettyYml()

    if (found !== undefined) {
      const configPath = path.resolve(process.cwd(), found)
      let projectName = path.basename(found, path.extname(found))
      let previewDomains: { host: string; target?: string }[] = []
      try {
        const parsed = yaml.parse(fs.readFileSync(configPath, 'utf8')) as { project?: string; domains?: unknown[] }
        if (typeof parsed.project === 'string' && parsed.project.trim() !== '') projectName = parsed.project
        if (Array.isArray(parsed.domains)) previewDomains = parsed.domains.filter(
          (d): d is { host: string; target?: string } =>
            typeof (d as Record<string, unknown>).host === 'string'
        )
      } catch { /* ignore */ }

      console.log(`\nProject: ${projectName} (${found})`)
      for (const d of previewDomains) console.log(`  ${d.host}${d.target !== undefined ? ` → ${d.target}` : ''}`)

      const { load } = await inquirer.prompt([{
        type: 'confirm',
        name: 'load',
        message: 'Start this project?',
        default: true,
      }]) as { load: boolean }
      if (load) await devCommand({ config: configPath })
    } else {
      const { create } = await inquirer.prompt([{
        type: 'confirm',
        name: 'create',
        message: 'No .betty.yml found in this directory. Create a new project?',
        default: true,
      }]) as { create: boolean }
      if (create) await projectCreateCommand({})
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printError(message)
    process.exit(1)
  }
}

export default projectCommand
