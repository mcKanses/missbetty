import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import yaml from 'yaml'
import inquirer from 'inquirer'
import { printError, printHint } from '../cli/ui/output'
import {
  getDockerPortOwners,
  getSystemPortOwners,
  filterSystemOwnersForBettyPort,
} from '../utils/portOwners'
import { getDomainSuffix } from '../utils/config'
import type { DockerInspectEntry, DockerNetworkEntry, TraefikDynamicConfig, TraefikRouter } from '../types'

const BETTY_HOME_DIR = path.join(os.homedir(), '.betty')
const BETTY_PROXY_COMPOSE = path.join(BETTY_HOME_DIR, 'docker-compose.yml')
const BETTY_DYNAMIC_DIR = path.join(BETTY_HOME_DIR, 'dynamic')
const BETTY_CERTS_DIR = path.join(BETTY_HOME_DIR, 'certs')
const TRAEFIK_NETWORK = 'betty_proxy'
const TRAEFIK_CONTAINER = 'betty-traefik'

const resolveTraefikComposePath = (): string => {
  if (fs.existsSync(BETTY_PROXY_COMPOSE)) return BETTY_PROXY_COMPOSE
  

  printError("Betty's proxy is not set up yet. Run: betty serve")
  process.exit(1)
}

const resolveDynamicDir = (): string => BETTY_DYNAMIC_DIR

const desiredProxyCompose = `services:
  traefik:
    image: traefik:v2.10
    container_name: ${TRAEFIK_CONTAINER}
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=${TRAEFIK_NETWORK}
      - --providers.file.directory=/dynamic
      - --providers.file.watch=true
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./dynamic:/dynamic:ro
      - ./certs:/certs:ro
    networks:
      - ${TRAEFIK_NETWORK}

networks:
  ${TRAEFIK_NETWORK}:
    external: true
    name: ${TRAEFIK_NETWORK}
`

const ensureProxyComposeFile = (): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) fs.mkdirSync(BETTY_DYNAMIC_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })

  if (!fs.existsSync(BETTY_PROXY_COMPOSE) || fs.readFileSync(BETTY_PROXY_COMPOSE, 'utf8') !== desiredProxyCompose) {
    fs.writeFileSync(BETTY_PROXY_COMPOSE, desiredProxyCompose, 'utf8')
    console.log(`Updated Docker Compose file: ${BETTY_PROXY_COMPOSE}`)
  }
}

const ensureHttpsPortAvailable = (): void => {
  const allDockerOwners = getDockerPortOwners(443)
  const bettyOwnsPort = allDockerOwners.some((owner) => owner.startsWith(TRAEFIK_CONTAINER))
  const dockerOwners = allDockerOwners.filter((owner) => !owner.startsWith(TRAEFIK_CONTAINER))
  if (bettyOwnsPort && dockerOwners.length === 0) return

  const systemOwners = filterSystemOwnersForBettyPort(getSystemPortOwners(443), bettyOwnsPort)

  if (dockerOwners.length === 0 && systemOwners.length === 0) return

  printError('Port 443 is already in use.')
  printHint('Betty needs host port 443 for HTTPS domains such as .dev.')
  if (dockerOwners.length > 0) {
    printHint('\nDocker containers publishing 443:')
    dockerOwners.forEach((owner) => { printHint(` - ${owner}`) })
  }
  if (systemOwners.length > 0) {
    printHint('\nProcesses listening on 443:')
    systemOwners.forEach((owner) => { printHint(` - ${owner}`) })
  }
  printHint('\nStop the conflicting HTTPS server or proxy, then run: betty link')
  process.exit(1)
}

const printProxyStartError = (message: string): void => {
  printError("Betty's proxy could not be started.")
  if (message.includes('Bind for 0.0.0.0:80 failed')) {
    printHint('Port 80 is already in use by another service.')
    printHint('Betty no longer needs host port 80. Run this command again to use the updated proxy compose file.')
    return
  }
  if (message.includes('port is already allocated') || message.includes('Bind for 0.0.0.0:443 failed')) {
    printHint('Port 443 is already in use. Stop the other HTTPS server or proxy, then run: betty serve')
    printHint('Useful check: docker ps --format "table {{.Names}}\\t{{.Ports}}"')
    return
  }
  printHint(message)
}

const ensureProxyRunning = (traefikComposePath: string): void => {
  try {
    execSync(`docker compose -f "${traefikComposePath}" up -d`, {
      cwd: path.dirname(traefikComposePath),
      stdio: 'inherit',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printProxyStartError(message)
    process.exit(1)
  }
}

const ensureTraefikNetwork = (): void => {
  try {
    execSync(`docker network inspect ${TRAEFIK_NETWORK}`, { stdio: 'pipe' })
  } catch {
    execSync(`docker network create ${TRAEFIK_NETWORK}`, { stdio: 'inherit' })
    console.log(`Created Docker network '${TRAEFIK_NETWORK}'.`)
  }
}

const connectContainerToNetwork = (containerName: string): void => {
  try {
    const info = JSON.parse(
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
    ) as DockerInspectEntry[]
    const networkKeys = Object.keys(info[0].NetworkSettings.Networks)
    if (networkKeys.includes(TRAEFIK_NETWORK)) return // already connected
    
  } catch {
    printError(`Container '${containerName}' not found.`)
    process.exit(1)
  }

  execSync(`docker network connect ${TRAEFIK_NETWORK} ${containerName}`, { stdio: 'inherit' })
  console.log(`Connected container '${containerName}' to network '${TRAEFIK_NETWORK}'.`)
}

const getContainerIp = (containerName: string): string => {
  const info = JSON.parse(
    execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
  ) as DockerInspectEntry[]
  const networks = info[0].NetworkSettings.Networks as Record<string, DockerNetworkEntry | undefined>
  const ip = networks[TRAEFIK_NETWORK]?.IPAddress ?? ''
  if (ip === '') {
    printError(`Could not determine IP for '${containerName}' in network '${TRAEFIK_NETWORK}'.`)
    process.exit(1)
  }
  return ip
}

const sanitizeFileName = (value: string): string => value.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase()

const ensureCertificate = (domain: string): { certFile: string; keyFile: string } | null => {
  if (!fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })
  

  const baseName = sanitizeFileName(domain)
  const certPath = path.join(BETTY_CERTS_DIR, `${baseName}.pem`)
  const keyPath = path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`)

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return {
      certFile: `/certs/${baseName}.pem`,
      keyFile: `/certs/${baseName}-key.pem`,
    }
  

  try {
    execSync('mkcert -install', { stdio: 'inherit' })
    execSync(`mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${domain}"`, { stdio: 'inherit' })
    return {
      certFile: `/certs/${baseName}.pem`,
      keyFile: `/certs/${baseName}-key.pem`,
    }
  } catch {
    console.log(`\n⚠️  Could not create a local certificate for ${domain}.`)
    console.log('   Install mkcert and run this command again to enable HTTPS for this domain.')
    console.log('   Routing will still be written, but Betty publishes HTTPS on port 443.')
    return null
  }
}

const writeDynamicConfig = (
  name: string,
  domain: string,
  ip: string,
  port: number,
  traefikComposePath: string,
  certificate: { certFile: string; keyFile: string } | null
): void => {
  const routers: Record<string, TraefikRouter> = {
    [name]: {
      rule: `Host("${domain}")`,
      entryPoints: ['web'],
      service: name,
    },
  }

  if (certificate) routers[`${name}-secure`] = {
      rule: `Host("${domain}")`,
      entryPoints: ['websecure'],
      service: name,
      tls: {},
    }
  

  const config: TraefikDynamicConfig = {
    http: {
      routers,
      services: {
        [name]: {
          loadBalancer: {
            servers: [{ url: `http://${ip}:${String(port)}` }],
          },
        },
      },
    },
  }

  if (certificate) config.tls = {
      certificates: [
        {
          certFile: certificate.certFile,
          keyFile: certificate.keyFile,
        },
      ],
    }
  

  const configYaml = yaml.stringify(config)
  const dynamicDir = resolveDynamicDir()

  if (!fs.existsSync(dynamicDir)) fs.mkdirSync(dynamicDir, { recursive: true })
  
  fs.writeFileSync(path.join(dynamicDir, `${name}.yml`), configYaml, 'utf8')
  console.log(`Wrote routing configuration: ${name}.yml`)

  // Restart Traefik so it picks up the config.
  // Windows bind mounts do not trigger inotify events in the container.
  execSync(`docker compose -f "${traefikComposePath}" restart traefik`, {
    cwd: path.dirname(traefikComposePath),
    stdio: 'inherit',
  })
  console.log('Restarted Traefik.')
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

const validateLocalDomain = (domain: string): true | string => {
  const normalized = domain.trim()
  if (!normalized) return 'Domain cannot be empty'
  return true
}

const findDomainConflict = (domain: string, ignoreFilePath?: string): { fileName: string; routerName: string } | null => {
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) return null

  const files = fs.readdirSync(BETTY_DYNAMIC_DIR).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  for (const file of files) {
    const filePath = path.join(BETTY_DYNAMIC_DIR, file)
    if (ignoreFilePath !== undefined && filePath === ignoreFilePath) continue

    try {
      const doc = yaml.parse(fs.readFileSync(filePath, 'utf8')) as TraefikDynamicConfig
      const routers: Record<string, TraefikRouter> = doc.http?.routers ?? {}
      for (const [routerName, router] of Object.entries(routers)) {
        const existingDomain = /Host\("([^"]+)"\)/.exec(router.rule ?? '')?.[1] ?? ''
        if (existingDomain.toLowerCase() === domain.toLowerCase()) return { fileName: file, routerName }
      }
    } catch {
      // ignore malformed route files
    }
  }

  return null
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
}

const normalizeDomainLabel = (value: string): string => value
  .toLowerCase()
  .replace(/_/g, '-')
  .replace(/[^a-z0-9-]/g, '')
  .replace(/^-+|-+$/g, '')

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
    const CUSTOM_PORT = '__custom__'
    if (exposedPorts.length > 0) {
      const choices = [
        ...exposedPorts.map(String),
        { name: 'Other (enter manually)', value: CUSTOM_PORT },
      ]
      const portAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'port',
        message: 'Port:',
        choices,
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
  const routeFileName = `${containerNameResolved.replace(/[^a-zA-Z0-9-]/g, '-')}.yml`
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

  ensureProxyComposeFile()
  const traefikComposePath = resolveTraefikComposePath()

  console.log(`Linking '${containerNameResolved}' to domain '${domainResolved}' on port ${String(port)}...`)

  ensureHttpsPortAvailable()
  ensureProxyRunning(traefikComposePath)
  ensureTraefikNetwork()      // ensure it exists if compose did not create the network
  connectContainerToNetwork(containerNameResolved)
  const ip = getContainerIp(containerNameResolved)
  const certificate = ensureCertificate(domainResolved)
  writeDynamicConfig(containerNameResolved.replace(/[^a-zA-Z0-9-]/g, '-'), domainResolved, ip, port, traefikComposePath, certificate)
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
    console.log(`\n⚠️  Routing was written, but no HTTPS certificate is available for ${domainResolved}.`)
    console.log('   Install mkcert and run this command again. Betty publishes HTTPS on port 443.')
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
