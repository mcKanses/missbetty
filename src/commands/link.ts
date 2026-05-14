import { execSync } from 'child_process'
import path from 'path'
import inquirer from 'inquirer'
import { printError, printHint } from '../cli/ui/output'
import { getDomainSuffix } from '../utils/config'
import type { DockerInspectEntry } from '../types'
import {
  resolveTraefikComposePath,
  connectContainerToNetwork,
  getContainerIp,
  getRunningContainers,
  restartTraefik,
  ensureCertificate,
} from '../utils/docker'
import { ensureHostsEntry } from '../utils/hosts'
import { findDomainConflict, writeRouteConfig } from '../utils/routes'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, printProxyStartError } from '../utils/proxy'
import { normalizeDomainLabel, normalizeServiceName } from '../utils/names'

const ensureProxyRunning = (traefikComposePath: string): void => {
  try {
    execSync(`docker compose -f "${traefikComposePath}" up -d`, {
      cwd: path.dirname(traefikComposePath),
      stdio: 'inherit',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printProxyStartError(message, 'link')
    process.exit(1)
  }
}

const validateLocalDomain = (domain: string): true | string => {
  const normalized = domain.trim()
  if (!normalized) return 'Domain cannot be empty'
  return true
}

interface LinkPromptAnswers {
  container?: string;
  domain?: string;
  port?: string;
}

interface LinkCommandOptions {
  domain?: string;
  port?: string;
  dryRun?: boolean;
  open?: boolean;
  yes?: boolean;
}

const stripReplicaSuffix = (value: string): string => value.replace(/-\d+$/, '')

interface DockerInspectComposeLabelsEntry extends DockerInspectEntry {
  Config?: {
    Labels?: Record<string, string>;
    ExposedPorts?: Record<string, unknown>;
  };
}

export const readExposedPorts = (containerName: string): number[] => {
  try {
    const info = JSON.parse(
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
    ) as DockerInspectComposeLabelsEntry[]
    const exposed = info[0]?.Config?.ExposedPorts ?? {}
    return Object.keys(exposed)
      .map((key) => parseInt(key.split('/')[0], 10))
      .filter((p) => Number.isFinite(p) && p > 0)
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

const readComposeLabels = (containerName: string): { project: string; service: string } | null => {
  try {
    const info = JSON.parse(
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
    ) as DockerInspectComposeLabelsEntry[]
    const labels = info[0]?.Config?.Labels ?? {}
    const project = normalizeDomainLabel(labels['com.docker.compose.project'] ?? '')
    const service = normalizeDomainLabel(labels['com.docker.compose.service'] ?? '')
    if (project === '' || service === '') return null
    return { project, service }
  } catch {
    return null
  }
}

export const suggestDomain = (containerName: string): string => {
  const suffix = getDomainSuffix()
  const compose = readComposeLabels(containerName)
  if (compose !== null) return `${compose.service}.${compose.project}${suffix}`

  const cleaned = normalizeDomainLabel(stripReplicaSuffix(containerName))
  if (cleaned === '') return `app${suffix}`
  return `${cleaned}${suffix}`
}

const linkCommand = async (containerName: string | undefined, opts: LinkCommandOptions): Promise<void> => {
  let resolvedContainer = containerName
  let resolvedDomain = opts.domain
  let resolvedPort = opts.port

  if (resolvedContainer === undefined || resolvedDomain === undefined) {
    const runningContainers = getRunningContainers()

    if (resolvedContainer === undefined && runningContainers.length === 0) {
      printError('No containers are currently running.')
      printHint('Start a container first, then run: betty link')
      process.exit(1)
    }

    const answers = await inquirer.prompt([
      ...(resolvedContainer === undefined ? [{
        type: runningContainers.length > 0 ? 'list' : 'input',
        name: 'container',
        message: 'Container:',
        ...(runningContainers.length > 0 ? { choices: runningContainers } : {}),
      }] : []),
      ...(resolvedDomain === undefined ? [{
        type: 'input',
        name: 'domain',
        message: 'Domain:',
        default: (answers: { container?: string }) => suggestDomain(resolvedContainer ?? answers.container ?? ''),
        validate: validateLocalDomain,
      }] : []),
    ]) as LinkPromptAnswers

    if (answers.container !== undefined && answers.container !== '') resolvedContainer = answers.container
    if (answers.domain !== undefined && answers.domain !== '') resolvedDomain = answers.domain
  }

  if (resolvedPort === undefined) {
    const exposedPorts = resolvedContainer !== undefined ? readExposedPorts(resolvedContainer) : []
    if (opts.yes === true) resolvedPort = exposedPorts.length > 0 ? String(exposedPorts[0]) : '80'
     else if (exposedPorts.length > 0) {
      const CUSTOM_PORT = '__custom__'
      const portAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'port',
        message: 'Port:',
        choices: [...exposedPorts.map(String), { name: 'Other (enter manually)', value: CUSTOM_PORT }],
        default: String(exposedPorts[0]),
      }]) as { port: string }
      if (portAnswer.port === CUSTOM_PORT) {
        const customAnswer = await inquirer.prompt([{
          type: 'input',
          name: 'port',
          message: 'Port:',
          validate: (v: string) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0) || 'Please provide a valid port',
        }]) as { port: string }
        resolvedPort = customAnswer.port
      } else resolvedPort = portAnswer.port
    } else {
      const portAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'port',
        message: 'Port:',
        default: '80',
        validate: (v: string) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0) || 'Please provide a valid port',
      }]) as { port: string }
      resolvedPort = portAnswer.port
    }
  }

  if (resolvedContainer === undefined || resolvedContainer === '') {
    printError('No container provided.')
    process.exit(1)
  }

  if (resolvedDomain === undefined || resolvedDomain === '') {
    printError('No domain provided.')
    process.exit(1)
  }

  const domainValidation = validateLocalDomain(resolvedDomain)
  if (domainValidation !== true) {
    printError(domainValidation)
    process.exit(1)
  }

  const port = parseInt(resolvedPort, 10)
  if (!Number.isFinite(port) || port <= 0) {
    printError('Invalid port. Example: --port 3000')
    process.exit(1)
  }

  const containerNameResolved = resolvedContainer
  const domainResolved = resolvedDomain.trim()
  const routeFileName = `${normalizeServiceName(containerNameResolved)}.yml`
  const conflict = findDomainConflict(domainResolved)
  if (conflict !== null) {
    printError(`Domain '${domainResolved}' is already linked by ${conflict.routerName} (${conflict.fileName}).`)
    printHint('Use `betty relink` to move an existing domain to another container.')
    process.exit(1)
  }

  if (opts.dryRun === true) {
    console.log('Dry run: no changes were applied.')
    console.log(`- container: ${containerNameResolved}`)
    console.log(`- domain: ${domainResolved}`)
    console.log(`- port: ${String(port)}`)
    console.log(`- route file: ${routeFileName}`)
    if (domainResolved.toLowerCase().endsWith('.localhost')) console.log('- hosts entry: not required for .localhost')
    else console.log(`- hosts entry: 127.0.0.1 ${domainResolved} # added by betty`)
    console.log('- traefik restart: yes')
    return
  }

  if (opts.yes !== true) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Link '${containerNameResolved}' → ${domainResolved}:${String(port)}?`,
      default: true,
    }]) as { confirm: boolean }
    if (!confirm) { console.log('Cancelled.'); return }
  }

  ensureProxySetup()
  const traefikComposePath = resolveTraefikComposePath()

  console.log(`Linking '${containerNameResolved}' to domain '${domainResolved}' on port ${String(port)}...`)

  ensureHttpsPortAvailable()
  ensureProxyRunning(traefikComposePath)
  ensureProxyNetwork()
  connectContainerToNetwork(containerNameResolved)
  const ip = getContainerIp(containerNameResolved)
  const certificate = ensureCertificate(domainResolved)
  writeRouteConfig(normalizeServiceName(containerNameResolved), domainResolved, ip, port, certificate)
  restartTraefik(traefikComposePath)
  const hostsUpdated = ensureHostsEntry(domainResolved)
  if (!hostsUpdated) console.log(`\n⚠️  The domain is only reachable after the hosts entry has been set: ${domainResolved}`)

  const hostsStatus = domainResolved.toLowerCase().endsWith('.localhost')
    ? 'not required (.localhost)'
    : hostsUpdated ? 'updated/ok' : 'manual action required'

  console.log('\nSummary:')
  console.log(`- domain: ${domainResolved}`)
  console.log(`- target: ${containerNameResolved}:${String(port)}`)
  console.log(`- route: ${routeFileName}`)
  console.log(`- hosts: ${hostsStatus}`)
  console.log('- traefik: restarted')

  if (certificate) {
    console.log(`\n✅ '${containerNameResolved}' is now available at https://${domainResolved}`)
    if (opts.open === true) openInBrowser(`https://${domainResolved}`)
  } else {
    console.log(`\n⚠️  Routing was written without TLS certificate for ${domainResolved}.`)
    console.log('   Using HTTP fallback on port 80.')
    if (opts.open === true) openInBrowser(`http://${domainResolved}`)
  }
}

const openInBrowser = (url: string): void => {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`
  try {
    execSync(cmd, { stdio: 'ignore' })
  } catch {
    printHint(`Could not open browser. Visit manually: ${url}`)
  }
}

export default linkCommand
