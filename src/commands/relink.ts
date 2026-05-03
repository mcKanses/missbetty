import { execSync } from 'child_process'
import fs from 'fs'
import inquirer from 'inquirer'
import { printError } from '../cli/ui/output'
import os from 'os'
import path from 'path'
import yaml from 'yaml'
import { checkMkcertInstalled, isHttpsRequestedDomain } from '../utils/setup'
import type { DockerInspectEntry, DockerNetworkEntry, TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'

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

const BETTY_HOME_DIR = path.join(os.homedir(), '.betty')
const BETTY_PROXY_COMPOSE = path.join(BETTY_HOME_DIR, 'docker-compose.yml')
const BETTY_DYNAMIC_DIR = path.join(BETTY_HOME_DIR, 'dynamic')
const BETTY_CERTS_DIR = path.join(BETTY_HOME_DIR, 'certs')
const TRAEFIK_NETWORK = 'betty_proxy'

const resolveTraefikComposePath = (): string => {
  if (fs.existsSync(BETTY_PROXY_COMPOSE)) return BETTY_PROXY_COMPOSE
  printError("Betty's proxy is not set up yet. Run: betty serve")
  process.exit(1)
}

const sanitizeFileName = (value: string): string => value.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase()

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

const getRunningContainers = (): string[] => {
  try {
    return execSync('docker ps --format {{.Names}}', { stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

const connectContainerToNetwork = (containerName: string): void => {
  try {
    const info = JSON.parse(execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()) as DockerInspectEntry[]
    const networkKeys = Object.keys(info[0].NetworkSettings.Networks)
    if (networkKeys.includes(TRAEFIK_NETWORK)) return
  } catch {
    printError(`Container '${containerName}' not found.`)
    process.exit(1)
  }

  execSync(`docker network connect ${TRAEFIK_NETWORK} ${containerName}`, { stdio: 'inherit' })
  console.log(`Connected container '${containerName}' to network '${TRAEFIK_NETWORK}'.`)
}

const getContainerIp = (containerName: string): string => {
  const info = JSON.parse(execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()) as DockerInspectEntry[]
  const networks = info[0].NetworkSettings.Networks as Record<string, DockerNetworkEntry | undefined>
  const ip = networks[TRAEFIK_NETWORK]?.IPAddress ?? ''
  if (ip === '') {
    printError(`Could not determine IP for '${containerName}' in network '${TRAEFIK_NETWORK}'.`)
    process.exit(1)
  }
  return ip
}

const ensureCertificate = (domain: string): { certFile: string; keyFile: string } | null => {
  if (!fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })

  const baseName = sanitizeFileName(domain)
  const certPath = path.join(BETTY_CERTS_DIR, `${baseName}.pem`)
  const keyPath = path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`)
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return { certFile: `/certs/${baseName}.pem`, keyFile: `/certs/${baseName}-key.pem` }

  const httpsRequested = isHttpsRequestedDomain(domain)
  if (!checkMkcertInstalled()) {
    if (httpsRequested) {
      printError('HTTPS requested but mkcert is not installed. Run `betty setup`.')
      process.exit(1)
    }

    console.log(`\n⚠️  mkcert is not installed. Falling back to HTTP for ${domain}.`)
    return null
  }
  

  try {
    execSync('mkcert -install', { stdio: 'inherit' })
    execSync(`mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${domain}"`, { stdio: 'inherit' })
    return { certFile: `/certs/${baseName}.pem`, keyFile: `/certs/${baseName}-key.pem` }
  } catch {
    if (httpsRequested) {
      printError(`HTTPS requested for ${domain} but certificate creation failed. Run \`betty setup\`.`)
      process.exit(1)
    }

    console.log(`\n⚠️  Could not create a local certificate for ${domain}.`)
    console.log('   Falling back to HTTP on port 80 for this domain.')
    return null
  }
}

const ensureHostsEntry = (domain: string): boolean => {
  if (domain.toLowerCase().endsWith('.localhost')) return true
  

  const hostsPath = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts'
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = `127.0.0.1 ${domain} # added by betty`
  const hasEntry = (): boolean => {
    const content = fs.readFileSync(hostsPath, 'utf8')
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content)
  }

  try {
    if (hasEntry()) return true
  } catch {
    // continue to append attempt or manual hint
  }

  try {
    fs.appendFileSync(hostsPath, `\n${entry}\n`, 'utf8')
    console.log(`Added hosts entry: ${entry}`)
    return true
  } catch {
    if (process.platform === 'win32') {
      const scriptPath = path.join(os.tmpdir(), `betty-hosts-append-${String(Date.now())}.ps1`)
      const scriptDomain = domain.replace(/'/g, "''")
      const scriptEntry = entry.replace(/'/g, "''")
      const script = [
        "$ErrorActionPreference = 'Stop'",
        `$domain = '${scriptDomain}'`,
        `$entry = '${scriptEntry}'`,
        "$hostsPath = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'",
        "$content = [System.IO.File]::ReadAllText($hostsPath)",
        "if ($content -match ('(?m)(^|\\s)' + [regex]::Escape($domain) + '(\\s|$)')) { exit 0 }",
        "[System.IO.File]::AppendAllText($hostsPath, \"`r`n$entry`r`n\", [System.Text.Encoding]::UTF8)",
      ].join('\n')

      fs.writeFileSync(scriptPath, script, 'utf8')
      try {
        execSync(
          `powershell -NoProfile -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -Wait"`,
          { stdio: 'inherit' }
        )
        return hasEntry()
      } catch {
        // manual hint below
      } finally {
        try {
          fs.unlinkSync(scriptPath)
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  console.log(`\n⚠️  Could not add hosts entry automatically.`)
  console.log(`   Add this line manually to ${hostsPath}:`)
  console.log(`   ${entry}`)
  return false
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

const restartTraefik = (composePath: string): void => {
  execSync(`docker compose -f "${composePath}" restart traefik`, {
    cwd: path.dirname(composePath),
    stdio: 'inherit',
  })
  console.log('Restarted Traefik.')
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
