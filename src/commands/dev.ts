import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'
import yaml from 'yaml'
import { printHint, printWarn } from '../cli/ui/output'
import { checkDockerRunning, getMkcertRootCaPath, runMkcertInstall } from '../utils/setup'
import { ensureCertificate, restartTraefik } from '../utils/docker'
import { ensureHostsEntries, hasHostsEntry } from '../utils/hosts'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService, TraefikTcpService } from '../types'
import {
  BETTY_HOME_DIR,
  BETTY_PROXY_COMPOSE,
  BETTY_DYNAMIC_DIR,
} from '../utils/constants'
import { sanitizeName, validateDomain } from '../utils/names'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, ensureProxyRunning } from '../utils/proxy'
import { DATABASE_PROTOCOLS, databaseUrl, domainUrl, isDatabaseTarget } from '../utils/config'
import { BettyError } from '../utils/errors'
import { withLock, withLockAsync } from '../utils/lock'
import { findDomainConflict, loadedFromElsewhere, projectRouteFile, readRoutes, tlsOptionsName } from '../utils/routes'

type PermissionMode = 'prompt' | 'allowed' | 'manual' | 'denied'

interface DevDomainConfig {
  host: string;
  target: string;
}

export interface DevProjectConfig {
  project: string;
  up?: { command?: string };
  down?: { command?: string };
  domains: DevDomainConfig[];
  https?: {
    enabled?: boolean;
    certificateAuthority?: string;
  };
  permissions?: {
    hosts?: PermissionMode;
    trustStore?: PermissionMode;
    docker?: PermissionMode;
  };
}

interface DevCommandOptions {
  config?: string;
  dryRun?: boolean;
  yes?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const DEFAULT_POSTGRES_PORT = '5432'

const parsePermission = (value: unknown): PermissionMode | undefined => {
  if (value === undefined) return undefined
  if (value === 'prompt' || value === 'allowed' || value === 'manual' || value === 'denied') return value
  const label = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : 'non-scalar value'
  throw new Error(`Invalid permission mode '${label}'. Use prompt, allowed, manual, or denied.`)
}

export const resolveConfigPath = (configPath?: string): string => {
  if (configPath !== undefined) return path.resolve(process.cwd(), configPath)

  const candidates = ['.betty.yml', '.betty.yaml', '.missbetty.yml', '.missbetty.yaml']
  const match = candidates.find((candidate) => fs.existsSync(path.resolve(process.cwd(), candidate)))
  if (match !== undefined) return path.resolve(process.cwd(), match)
  throw new Error('No .betty.yml found in the current directory.')
}

export const readDevProjectConfig = (configPath: string): DevProjectConfig => {
  const parsed = yaml.parse(fs.readFileSync(configPath, 'utf8')) as unknown
  if (!isRecord(parsed)) throw new Error('.betty.yml must contain a YAML object.')

  const project = asString(parsed.project)
  if (project === null) throw new Error('.betty.yml requires a non-empty project name.')

  const domainsRaw = parsed.domains
  if (!Array.isArray(domainsRaw) || domainsRaw.length === 0) throw new Error('.betty.yml requires at least one domain.')

  const domains = domainsRaw.map((domainRaw, index) => {
    if (!isRecord(domainRaw)) throw new Error(`domains[${String(index)}] must be an object.`)
    const host = asString(domainRaw.host)
    const target = asString(domainRaw.target)
    if (host === null) throw new Error(`domains[${String(index)}].host is required.`)
    const hostValidation = validateDomain(host)
    if (hostValidation !== true) throw new Error(`domains[${String(index)}].host: ${hostValidation}`)
    if (target === null) throw new Error(`domains[${String(index)}].target is required.`)
    try {
      const url = new URL(target)
      if (url.protocol !== 'http:' && url.protocol !== 'https:' && !DATABASE_PROTOCOLS.includes(url.protocol)) throw new Error('bad protocol')
      if (url.hostname === '') throw new Error('no host')
    } catch {
      throw new Error(`domains[${String(index)}].target must be an http(s) or postgres URL.`)
    }
    return { host, target }
  })

  const up = isRecord(parsed.up) ? { command: asString(parsed.up.command) ?? undefined } : undefined
  const down = isRecord(parsed.down) ? { command: asString(parsed.down.command) ?? undefined } : undefined
  const https = isRecord(parsed.https)
    ? {
        enabled: typeof parsed.https.enabled === 'boolean' ? parsed.https.enabled : undefined,
        certificateAuthority: asString(parsed.https.certificateAuthority) ?? undefined,
      }
    : undefined
  // Traefik matches TCP routers before HTTP routers, so a host used twice (say
  // once for the web app and once for the database) would send its HTTPS
  // traffic to the database.
  const seenHosts = new Set<string>()
  for (const domain of domains) {
    const key = domain.host.toLowerCase()
    if (seenHosts.has(key)) throw new Error(`domains: ${domain.host} is listed more than once. Give each target its own host, e.g. db.${domain.host}.`)
    seenHosts.add(key)
  }

  // Without TLS the connection carries no host name to route by.
  const databaseDomain = domains.find((domain) => isDatabaseTarget(domain.target))
  if (databaseDomain !== undefined && https?.enabled !== true) throw new Error(`${databaseDomain.host}: postgres targets need https.enabled: true in .betty.yml.`)

  const permissions = isRecord(parsed.permissions)
    ? {
        hosts: parsePermission(parsed.permissions.hosts),
        trustStore: parsePermission(parsed.permissions.trustStore),
        docker: parsePermission(parsed.permissions.docker),
      }
    : undefined

  return { project, up, down, domains, https, permissions }
}

const confirmPermission = async (message: string, mode: PermissionMode | undefined): Promise<boolean> => {
  const resolved = mode ?? 'prompt'
  if (resolved === 'allowed') return true
  if (resolved === 'manual' || resolved === 'denied') return false

  const answer = await inquirer.prompt([{
    type: 'confirm',
    name: 'ok',
    message,
    default: true,
  }]) as { ok: boolean }
  return answer.ok
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

const targetForTraefik = (target: string): string => {
  const url = new URL(target)
  if (LOOPBACK_HOSTS.includes(url.hostname.toLowerCase())) url.hostname = 'host.docker.internal'
  return url.toString().replace(/\/$/, '')
}

const databaseAddressForTraefik = (target: string): string => {
  const url = new URL(target)
  // postgres: is not a special URL scheme, so URL keeps the host's case.
  const hostname = LOOPBACK_HOSTS.includes(url.hostname.toLowerCase()) ? 'host.docker.internal' : url.hostname
  return `${hostname}:${url.port !== '' ? url.port : DEFAULT_POSTGRES_PORT}`
}

const writeProjectRoute = (
  project: string,
  domains: DevDomainConfig[],
  certificates: Record<string, { certFile: string; keyFile: string }>,
  httpsEnabled: boolean,
  configPath?: string
): void => {
  const routers: Record<string, TraefikRouter> = {}
  const services: Record<string, TraefikService> = {}
  const tcpRouters: Record<string, TraefikRouter> = {}
  const tcpServices: Record<string, TraefikTcpService> = {}
  const tlsOptions: Record<string, { alpnProtocols: string[] }> = {}

  domains.forEach((domain, index) => {
    const name = `${sanitizeName(project)}-${String(index + 1)}`
    // Traefik terminates TLS with the domain's certificate and passes plain TCP
    // on, so the database needs no certificate of its own. libpq insists on the
    // ALPN protocol 'postgresql' in direct TLS mode.
    if (isDatabaseTarget(domain.target)) {
      tcpRouters[name] = {
        rule: `HostSNI(\`${domain.host}\`)`,
        entryPoints: ['websecure'],
        service: name,
        tls: { options: tlsOptionsName(name) },
      }
      tcpServices[name] = { loadBalancer: { servers: [{ address: databaseAddressForTraefik(domain.target) }] } }
      tlsOptions[tlsOptionsName(name)] = { alpnProtocols: ['postgresql'] }
      return
    }
    routers[name] = {
      rule: `Host("${domain.host}")`,
      entryPoints: ['web'],
      service: name,
    }
    if (httpsEnabled) routers[`${name}-secure`] = {
        rule: `Host("${domain.host}")`,
        entryPoints: ['websecure'],
        service: name,
        tls: {},
      }
    services[name] = {
      loadBalancer: {
        servers: [{ url: targetForTraefik(domain.target) }],
      },
    }
  })

  const config: TraefikDynamicConfig = {}
  if (Object.keys(routers).length > 0) config.http = { routers, services }
  if (Object.keys(tcpRouters).length > 0) config.tcp = { routers: tcpRouters, services: tcpServices }
  const certList = Object.values(certificates)
  if (certList.length > 0) config.tls = { certificates: certList }
  if (Object.keys(tlsOptions).length > 0) config.tls = { ...config.tls, options: tlsOptions }

  const origin = configPath !== undefined ? `# betty-project-config: ${configPath}\n` : ''
  fs.writeFileSync(path.join(BETTY_DYNAMIC_DIR, `${sanitizeName(project)}.yml`), `${origin}${yaml.stringify(config)}`, 'utf8')
}

const prepareHosts = async (config: DevProjectConfig): Promise<void> => {
  const missing = config.domains.filter((domain) => !hasHostsEntry(domain.host))
  if (missing.length === 0) return
  const mode = config.permissions?.hosts ?? 'prompt'

  // All entries go in one hosts edit: a single elevation prompt on Windows.
  if (mode === 'allowed') {
    ensureHostsEntries(missing.map((domain) => domain.host))
    return
  }

  if (mode === 'manual' || mode === 'denied') {
    for (const domain of missing) {
      printWarn(`Hosts entry was not changed for ${domain.host}.`)
      printHint(`Add manually: 127.0.0.1 ${domain.host} # added by betty`)
    }
    return
  }

  let selected: string[]
  if (missing.length === 1) {
    const ok = await confirmPermission(`Add hosts entry for ${missing[0].host}?`, 'prompt')
    selected = ok ? [missing[0].host] : []
  } else {
    const answer = await inquirer.prompt([{
      type: 'checkbox',
      name: 'hosts',
      message: 'Add hosts entries for (a = all/none):',
      choices: missing.map((d) => ({ name: d.host, value: d.host, checked: true })),
    }]) as { hosts: string[] }
    selected = answer.hosts
  }

  ensureHostsEntries(selected)
  for (const domain of missing) if (!selected.includes(domain.host)) {
    printWarn(`Hosts entry was not changed for ${domain.host}.`)
    printHint(`Add manually: 127.0.0.1 ${domain.host} # added by betty`)
  }
}

const prepareCertificates = async (config: DevProjectConfig): Promise<Record<string, { certFile: string; keyFile: string }>> => {
  if (config.https?.enabled !== true) return {}

  if (config.https.certificateAuthority !== undefined && config.https.certificateAuthority !== 'missbetty') throw new Error('Only certificateAuthority: missbetty is currently supported.')

  const allowed = await confirmPermission('Install or verify the local mkcert CA?', config.permissions?.trustStore)
  if (!allowed) throw new Error('HTTPS is enabled, but trustStore permission was not granted.')

  const ca = runMkcertInstall()
  if (!ca.ok) throw new Error(ca.warning ?? 'mkcert CA setup failed.')

  const certificates: Record<string, { certFile: string; keyFile: string }> = {}
  config.domains.forEach((domain) => {
    const certificate = ensureCertificate(domain.host, { required: true })
    if (certificate === null) throw new Error(`Could not create a certificate for ${domain.host}.`)
    certificates[domain.host] = certificate
  })
  return certificates
}

export const runProjectCommand = (command: string, configPath: string): void => {
  execSync(command, {
    cwd: path.dirname(configPath),
    stdio: 'inherit',
  })
}

export const printUrls = (config: DevProjectConfig): void => {
  console.log('\nAvailable URLs:')
  config.domains.forEach((domain) => {
    const url = isDatabaseTarget(domain.target)
      ? `${databaseUrl(domain.host)} (sslnegotiation=direct)`
      : domainUrl(domain.host, config.https?.enabled === true)
    console.log(`- ${url} -> ${domain.target}`)
  })

  const databaseDomains = config.domains.filter((domain) => isDatabaseTarget(domain.target))
  if (databaseDomains.length === 0) return
  // libpq's sslrootcert=system reads OpenSSL's store, which on Windows is not the
  // one mkcert installs into, so point at the mkcert root CA file instead. The
  // URI percent-decodes its values; spaces (e.g. in a user folder) are encoded.
  const rootCa = (getMkcertRootCaPath() ?? '<mkcert -CAROOT>/rootCA.pem').replace(/ /g, '%20')
  printHint('Database domains need a PostgreSQL 17+ client with direct TLS, for example:')
  for (const domain of databaseDomains) printHint(`psql "${databaseUrl(domain.host).replace(/^postgres:\/\//, 'postgresql://postgres@')}/postgres?sslmode=verify-full&sslnegotiation=direct&sslrootcert=${rootCa}"`)
}

interface LinkProjectOptions {
  yes?: boolean;
  // The .betty.yml being loaded; used to tell same-named projects apart.
  configPath?: string;
}

const linkProjectImpl = async (config: DevProjectConfig, opts: LinkProjectOptions): Promise<void> => {
  const resolvePermission = (mode: PermissionMode | undefined): PermissionMode | undefined =>
    opts.yes === true && (mode ?? 'prompt') === 'prompt' ? 'allowed' : mode

  const effectiveConfig: DevProjectConfig = opts.yes !== true ? config : {
    ...config,
    permissions: {
      hosts: resolvePermission(config.permissions?.hosts),
      trustStore: resolvePermission(config.permissions?.trustStore),
      docker: resolvePermission(config.permissions?.docker),
    },
  }

  // Check for conflicts before touching hosts, certificates or the proxy, so a
  // rejected project leaves nothing behind.
  const ownRouteFile = projectRouteFile(config.project)
  const loadedFrom = opts.configPath !== undefined ? loadedFromElsewhere(config.project, opts.configPath) : null
  if (loadedFrom !== null) throw new BettyError(`Project '${config.project}' is already loaded from ${loadedFrom}.`, {
    hints: ['Give this project another name in .betty.yml, or run `betty project stop` in the other project first.'],
  })
  // Project routers are named <project>-<n>. Anything else in the file means it
  // is a `betty link` route file whose name happens to match the project.
  const routerPrefix = `${sanitizeName(config.project)}-`
  const foreign = readRoutes().find((r) => r.filePath === ownRouteFile && !(r.routerName.startsWith(routerPrefix) && /^[0-9]+$/.test(r.routerName.slice(routerPrefix.length))))
  if (foreign !== undefined) throw new BettyError(`The route file ${foreign.fileName} already belongs to the link for ${foreign.domain}.`, {
    hints: ['Give this project another name in .betty.yml, or run `betty unlink --domain ' + foreign.domain + '` first.'],
  })
  for (const domain of config.domains) if (findDomainConflict(domain.host, { filePath: ownRouteFile }) !== null) throw new Error(`Domain '${domain.host}' is already linked. Run \`betty unlink\` first.`)

  await prepareHosts(effectiveConfig)
  const certificates = await prepareCertificates(effectiveConfig)

  const dockerAllowed = await confirmPermission('Run Docker commands for the Betty proxy and project startup?', effectiveConfig.permissions?.docker)
  if (!dockerAllowed) throw new Error('Docker permission was not granted.')
  if (!checkDockerRunning()) throw new Error('Docker is not running or is not available.')

  ensureProxySetup({ certs: true })
  ensureHttpsPortAvailable()
  ensureProxyNetwork()
  ensureProxyRunning(BETTY_PROXY_COMPOSE, 'project load')

  writeProjectRoute(config.project, config.domains, certificates, config.https?.enabled === true, opts.configPath)
  restartTraefik(BETTY_PROXY_COMPOSE)
}

// The lock covers only the route and hosts changes. The project's up command can
// run for as long as the developer works, and holding the lock through it would
// block every other betty command.
export const linkProject = (config: DevProjectConfig, opts: LinkProjectOptions): Promise<void> =>
  withLockAsync(() => linkProjectImpl(config, opts))

const INTERRUPTED_EXIT_CODES = [130, 0xC000013A]

const devCommand = async (opts: DevCommandOptions): Promise<void> => {
  let cleanExit = false
  try {
    const configPath = resolveConfigPath(opts.config)
    const config = readDevProjectConfig(configPath)

    if (opts.dryRun === true) {
      console.log(`Project: ${config.project}`)
      config.domains.forEach((domain) => { console.log(`- ${domain.host} -> ${domain.target}`) })
      if (config.up?.command !== undefined) console.log(`Up: ${config.up.command}`)
      return
    }

    await linkProject(config, { yes: opts.yes, configPath })

    if (config.up?.command !== undefined) {
      const ownRouteFile = path.join(BETTY_DYNAMIC_DIR, `${sanitizeName(config.project)}.yml`)
      // Ctrl+C reaches betty as well as the up command. Without a listener Node
      // would exit at once and skip the cleanup below; with one, spawnSync returns
      // once the command has stopped.
      const ignoreSigint = (): void => undefined
      process.on('SIGINT', ignoreSigint)
      let result: ReturnType<typeof spawnSync>
      try {
        result = spawnSync(config.up.command, { shell: true, cwd: path.dirname(configPath), stdio: 'inherit' })
      } finally {
        process.off('SIGINT', ignoreSigint)
      }
      // Commands that trap SIGINT themselves (e.g. docker compose) exit with a
      // status instead of a signal: 130 on POSIX, 0xC000013A on Windows.
      const interrupted = result.signal !== null || (result.status !== null && INTERRUPTED_EXIT_CODES.includes(result.status))
      if (interrupted) {
        try {
          withLock(() => {
            try { fs.unlinkSync(ownRouteFile) } catch { /* best-effort */ }
            try { execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" restart traefik`, { cwd: BETTY_HOME_DIR, stdio: 'pipe' }) } catch { /* best-effort */ }
          })
        } catch { /* best-effort: another betty command holds the lock */ }
        if (config.down?.command !== undefined) try { runProjectCommand(config.down.command, configPath) } catch { /* best-effort */ }
        cleanExit = true
      } else if (result.status !== null && result.status !== 0) throw new Error(`Up command exited with code ${String(result.status)}`)
    }
    if (!cleanExit) printUrls(config)
  } catch (err) {
    if (err instanceof BettyError) throw err
    throw new BettyError(err instanceof Error ? err.message : String(err))
  }
  if (cleanExit) process.exit(0)
}

export default devCommand
