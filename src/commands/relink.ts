import path from 'path'
import inquirer from 'inquirer'
import { BettyError } from '../utils/errors'
import { withLockAsync } from '../utils/lock'
import {
  resolveTraefikComposePath,
  connectContainerToNetwork,
  getContainerIp,
  getRunningContainers,
  restartTraefik,
  ensureCertificate,
} from '../utils/docker'
import { ensureHostsEntry } from '../utils/hosts'
import { readRoutes, findDomainConflict, writeRouteConfig, type RouteEntry } from '../utils/routes'
import { normalizeServiceName } from '../utils/names'

interface RelinkOptions {
  container?: string;
  domain?: string;
  port?: string;
  yes?: boolean;
}

interface SelectRouteAnswer {
  route: string;
}

const selectRoute = async (routes: RouteEntry[], target?: string): Promise<RouteEntry> => {
  if (target === undefined && routes.length === 1) return routes[0]

  if (target !== undefined) {
    const normalized = target.toLowerCase()
    const matches = routes.filter((route) =>
      route.routerName.toLowerCase() === normalized ||
      route.container.toLowerCase() === normalized ||
      route.domain.toLowerCase() === normalized ||
      path.basename(route.fileName, path.extname(route.fileName)).toLowerCase() === normalized
    )
    if (matches.length === 1) return matches[0]
  }

  const answer = await inquirer.prompt([{
    type: 'list',
    name: 'route',
    message: 'Which link should be updated?',
    choices: routes.map((route) => ({
      name: `${route.routerName} -> ${route.domain} (${route.target || 'n/a'})`,
      value: route.filePath,
    })),
  }]) as SelectRouteAnswer
  return routes.find((route) => route.filePath === answer.route) ?? routes[0]
}

interface RelinkPromptAnswers {
  container?: string;
  domain?: string;
  port?: string;
}

const relinkCommandImpl = async (target?: string, opts?: RelinkOptions): Promise<void> => {
  const composePath = resolveTraefikComposePath()
  const routes = readRoutes()
  if (routes.length === 0) {
    console.log('No links found.')
    return
  }

  const route = await selectRoute(routes, target)
  const runningContainers = getRunningContainers()
  const shouldPromptValues = opts?.yes !== true && opts?.container === undefined && opts?.domain === undefined && opts?.port === undefined

  const answers = await inquirer.prompt([
    ...(shouldPromptValues ? [{
      type: runningContainers.length > 0 ? 'list' : 'input',
      name: 'container',
      message: 'Container:',
      default: route.container,
      ...(runningContainers.length > 0 ? { choices: runningContainers } : {}),
    }] : []),
    ...(shouldPromptValues ? [{
      type: 'input',
      name: 'domain',
      message: 'Domain:',
      default: route.domain,
      validate: (value: string) => !!value.trim() || 'Domain cannot be empty',
    }] : []),
    ...(shouldPromptValues ? [{
      type: 'input',
      name: 'port',
      message: 'Port:',
      default: route.port || '80',
      validate: (value: string) => (Number.isFinite(parseInt(value, 10)) && parseInt(value, 10) > 0) || 'Please provide a valid port',
    }] : []),
  ]) as RelinkPromptAnswers

  const containerName = (opts?.container ?? answers.container ?? route.container).trim()
  const domain = (opts?.domain ?? answers.domain ?? route.domain).trim()
  const port = parseInt((opts?.port ?? answers.port ?? route.port) || '80', 10)

  if (!containerName) throw new BettyError('No container provided.')

  if (!domain) throw new BettyError('No domain provided.')

  const conflict = findDomainConflict(domain, route.filePath)
  if (conflict !== null) throw new BettyError(`Domain '${domain}' is already linked by ${conflict.routerName} (${conflict.fileName}).`)

  if (!Number.isFinite(port) || port <= 0) throw new BettyError('Invalid port. Example: --port 3000')

  if (opts?.yes !== true) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Update link: ${containerName} → ${domain}:${String(port)}?`,
      default: true,
    }]) as { confirm: boolean }
    if (!confirm) { console.log('Cancelled.'); return }
  }

  connectContainerToNetwork(containerName)
  const ip = getContainerIp(containerName)
  const certificate = ensureCertificate(domain)
  const routeFileName = `${normalizeServiceName(domain)}.yml`
  writeRouteConfig(containerName, domain, ip, port, certificate, route.filePath)
  const hostsUpdated = ensureHostsEntry(domain)
  if (!hostsUpdated) console.log(`\n⚠️  The domain is only reachable after the hosts entry has been set: ${domain}`)

  restartTraefik(composePath)

  const hostsStatus = domain.toLowerCase().endsWith('.localhost')
    ? 'not required (.localhost)'
    : hostsUpdated ? 'updated/ok' : 'manual action required'

  console.log('\nSummary:')
  console.log(`- domain: ${domain}`)
  console.log(`- target: ${containerName}:${String(port)}`)
  console.log(`- route: ${routeFileName}`)
  console.log(`- hosts: ${hostsStatus}`)
  console.log('- traefik: restarted')

  console.log(`\n✅ Updated link: ${containerName} -> ${domain}:${String(port)}`)
  if (certificate) console.log(`✅ HTTPS is available at https://${domain}`)
}

const relinkCommand = (target?: string, opts?: RelinkOptions): Promise<void> =>
  withLockAsync(() => relinkCommandImpl(target, opts))

export default relinkCommand
