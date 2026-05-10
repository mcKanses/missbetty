import fs from 'fs'
import inquirer from 'inquirer'
import { printError } from '../cli/ui/output'
import path from 'path'
import yaml from 'yaml'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'
import { BETTY_DYNAMIC_DIR } from '../utils/constants'
import {
  resolveTraefikComposePath,
  connectContainerToNetwork,
  getContainerIp,
  getRunningContainers,
  restartTraefik,
  ensureCertificate,
} from '../utils/docker'
import { ensureHostsEntry } from '../utils/hosts'

interface RouteEntry {
  filePath: string;
  fileName: string;
  routerName: string;
  domain: string;
  target: string;
  port: string;
}

interface RelinkOptions {
  container?: string;
  domain?: string;
  port?: string;
}

const readRoutes = (): RouteEntry[] => {
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) return []

  return fs.readdirSync(BETTY_DYNAMIC_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => {
      const filePath = path.join(BETTY_DYNAMIC_DIR, file)
      try {
        const doc = yaml.parse(fs.readFileSync(filePath, 'utf8')) as TraefikDynamicConfig
        const routers: Record<string, TraefikRouter> = doc.http?.routers ?? {}
        const services: Record<string, TraefikService> = doc.http?.services ?? {}
        const routerKeys = Object.keys(routers)
        const firstRouterKey = routerKeys.find((key) => !key.endsWith('-secure'))
          ?? (routerKeys.length > 0 ? routerKeys[0] : path.basename(file, path.extname(file)))
        const serviceKeys = Object.keys(services)
        const firstServiceKey = serviceKeys.length > 0 ? serviceKeys[0] : firstRouterKey
        const rule = routers[firstRouterKey].rule ?? ''
        const domain = /Host\("([^"]+)"\)/.exec(rule)?.[1] ?? ''
        const target = services[firstServiceKey].loadBalancer?.servers?.[0]?.url ?? ''
        const port = /:(\d+)(?:\/)?$/.exec(target)?.[1] ?? ''
        return { filePath, fileName: file, routerName: firstRouterKey, domain, target, port }
      } catch {
        return null
      }
    })
    .filter((entry): entry is RouteEntry => entry !== null)
}

const findDomainConflict = (domain: string, ignoreFilePath?: string): { fileName: string; routerName: string } | null => {
  const routes = readRoutes()
  for (const route of routes) {
    if (ignoreFilePath !== undefined && route.filePath === ignoreFilePath) continue
    if (route.domain.toLowerCase() !== domain.toLowerCase()) continue
    return { fileName: route.fileName, routerName: route.routerName }
  }
  return null
}

const writeRoute = (
  route: RouteEntry,
  containerName: string,
  domain: string,
  ip: string,
  port: number,
  certificate: { certFile: string; keyFile: string } | null
): void => {
  const serviceName = containerName.replace(/[^a-zA-Z0-9-]/g, '-')
  const routers: Record<string, TraefikRouter> = {
    [serviceName]: {
      rule: `Host("${domain}")`,
      entryPoints: ['web'],
      service: serviceName,
    },
  }

  if (certificate) routers[`${serviceName}-secure`] = {
    rule: `Host("${domain}")`,
    entryPoints: ['websecure'],
    service: serviceName,
    tls: {},
  }

  const config: TraefikDynamicConfig = {
    http: {
      routers,
      services: {
        [serviceName]: {
          loadBalancer: {
            servers: [{ url: `http://${ip}:${String(port)}` }],
          },
        },
      },
    },
  }

  if (certificate) config.tls = {
    certificates: [{ certFile: certificate.certFile, keyFile: certificate.keyFile }],
  }

  const nextPath = path.join(BETTY_DYNAMIC_DIR, `${serviceName}.yml`)
  if (route.filePath !== nextPath && fs.existsSync(route.filePath)) fs.unlinkSync(route.filePath)
  fs.writeFileSync(nextPath, yaml.stringify(config), 'utf8')
  console.log(`Updated routing configuration: ${path.basename(nextPath)}`)
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

const relinkCommand = async (target?: string, opts?: RelinkOptions): Promise<void> => {
  const composePath = resolveTraefikComposePath()
  const routes = readRoutes()
  if (routes.length === 0) {
    console.log('No links found.')
    return
  }

  const route = await selectRoute(routes, target)
  const runningContainers = getRunningContainers()
  const shouldPromptValues = opts?.container === undefined && opts?.domain === undefined && opts?.port === undefined

  const answers = await inquirer.prompt([
    ...(shouldPromptValues ? [{
      type: runningContainers.length > 0 ? 'list' : 'input',
      name: 'container',
      message: 'Container:',
      default: route.routerName,
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

  const containerName = (opts?.container ?? answers.container ?? route.routerName).trim()
  const domain = (opts?.domain ?? answers.domain ?? route.domain).trim()
  const port = parseInt((opts?.port ?? answers.port ?? route.port) || '80', 10)

  if (!containerName) {
    printError('No container provided.')
    process.exit(1)
  }

  if (!domain) {
    printError('No domain provided.')
    process.exit(1)
  }

  const conflict = findDomainConflict(domain, route.filePath)
  if (conflict !== null) {
    printError(`Domain '${domain}' is already linked by ${conflict.routerName} (${conflict.fileName}).`)
    process.exit(1)
  }

  if (!Number.isFinite(port) || port <= 0) {
    printError('Invalid port. Example: --port 3000')
    process.exit(1)
  }

  connectContainerToNetwork(containerName)
  const ip = getContainerIp(containerName)
  const certificate = ensureCertificate(domain)
  const routeFileName = `${containerName.replace(/[^a-zA-Z0-9-]/g, '-')}.yml`
  writeRoute(route, containerName, domain, ip, port, certificate)
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

export default relinkCommand
