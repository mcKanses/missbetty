import path from 'path'
import inquirer from 'inquirer'
import { domainUrl } from '../utils/config'
import { BettyError } from '../utils/errors'
import { withLockAsync } from '../utils/lock'
import {
  resolveTraefikComposePath,
  connectContainerToNetwork,
  getRunningContainers,
  restartTraefik,
  ensureCertificate,
} from '../utils/docker'
import { ensureHostsEntry, removeHostsEntry } from '../utils/hosts'
import { readRoutes, findDomainConflict, removeRouteFromFile, writeRouteConfig, type RouteEntry } from '../utils/routes'
import { normalizeServiceName, validateDomain } from '../utils/names'

interface RelinkOptions {
  container?: string;
  domain?: string;
  port?: string;
  yes?: boolean;
}

interface SelectRouteAnswer {
  route: string;
}

const selectRoute = async (routes: RouteEntry[], target?: string, yes?: boolean): Promise<RouteEntry> => {
  let candidates = routes
  if (target !== undefined) {
    const normalized = target.toLowerCase()
    candidates = routes.filter((route) =>
      route.routerName.toLowerCase() === normalized ||
      route.container.toLowerCase() === normalized ||
      route.domain.toLowerCase() === normalized ||
      path.basename(route.fileName, path.extname(route.fileName)).toLowerCase() === normalized
    )
    if (candidates.length === 0) throw new BettyError(`No link matches '${target}'.`, { hints: ['Run `betty status` to list the linked domains.'] })
  }

  if (candidates.length === 1) return candidates[0]

  // -y must never fall back to an interactive picker: without a TTY the prompt
  // crashes, and silently picking one of several links would be a guess.
  if (yes === true) throw new BettyError(target !== undefined ? `'${target}' matches ${String(candidates.length)} links.` : 'Multiple links found.', {
    hints: ['Pass the domain to pick one: betty relink <domain>', ...candidates.map((route) => ` - ${route.domain}`)],
  })

  const answer = await inquirer.prompt([{
    type: 'list',
    name: 'route',
    message: 'Which link should be updated?',
    choices: candidates.map((route) => ({
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

  const route = await selectRoute(routes, target, opts?.yes)
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
      validate: validateDomain,
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

  const domainValidation = validateDomain(domain)
  if (domainValidation !== true) throw new BettyError(domainValidation)

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

  const linkedContainer = connectContainerToNetwork(containerName)
  const certificate = ensureCertificate(domain)
  const routeFileName = `${normalizeServiceName(domain)}.yml`
  // A project file holds several domains. Replacing it would drop the others, so
  // only this route is taken out and the new one is written as its own file.
  const sharesFile = routes.some((r) => r.filePath === route.filePath && r.routerName !== route.routerName)
  if (sharesFile) {
    removeRouteFromFile(route)
    writeRouteConfig(linkedContainer, domain, port, certificate)
  } else writeRouteConfig(linkedContainer, domain, port, certificate, route.filePath)
  const hostsUpdated = ensureHostsEntry(domain)
  if (!hostsUpdated) console.log(`\n⚠️  The domain is only reachable after the hosts entry has been set: ${domain}`)

  // Moving a link to a new domain would otherwise leave the old hosts entry behind.
  // The old route file is being replaced, so only other files can still need it.
  const previousDomain = route.domain
  if (previousDomain !== '' && previousDomain.toLowerCase() !== domain.toLowerCase()) {
    const stillUsed = readRoutes().some((r) => r.filePath !== route.filePath && r.domain.toLowerCase() === previousDomain.toLowerCase())
    if (!stillUsed) removeHostsEntry(previousDomain)
  }

  restartTraefik(composePath)

  const hostsStatus = domain.toLowerCase().endsWith('.localhost')
    ? 'not required (.localhost)'
    : hostsUpdated ? 'updated/ok' : 'manual action required'

  console.log('\nSummary:')
  console.log(`- domain: ${domain}`)
  console.log(`- target: ${linkedContainer}:${String(port)}`)
  console.log(`- route: ${routeFileName}`)
  console.log(`- hosts: ${hostsStatus}`)
  console.log('- traefik: restarted')

  console.log(`\n✅ Updated link: ${linkedContainer} -> ${domain}:${String(port)}`)
  if (certificate) console.log(`✅ HTTPS is available at ${domainUrl(domain, true)}`)
}

const relinkCommand = (target?: string, opts?: RelinkOptions): Promise<void> =>
  withLockAsync(() => relinkCommandImpl(target, opts))

export default relinkCommand
