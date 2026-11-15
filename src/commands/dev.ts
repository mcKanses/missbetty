import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { prompt } from '../utils/prompt'
import yaml from 'yaml'
import { printHint, printWarn } from '../cli/ui/output'
import { checkDockerRunning, getMkcertRootCaPath, isHttpsRequestedDomain, runMkcertInstall } from '../utils/setup'
import { ensureCertificate, restartTraefik } from '../utils/docker'
import { hasHostsEntry, updateHostsEntries } from '../utils/hosts'
import unlinkCommand from './unlink'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService, TraefikTcpService } from '../types'
import {
  BETTY_PROXY_COMPOSE,
  BETTY_DYNAMIC_DIR,
} from '../utils/constants'
import { sanitizeName, validateDomain } from '../utils/names'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, ensureProxyRunning } from '../utils/proxy'
import { DATABASE_PROTOCOLS, databaseUrl, domainUrl, isDatabaseTarget } from '../utils/config'
import { BettyError } from '../utils/errors'
import { withLockAsync } from '../utils/lock'
import { isProjectTrusted, trustProject } from '../utils/projectTrust'
import { findDomainConflict, isProjectRouter, loadedFromElsewhere, projectRouteFile, readRoutes, routeFilesUnderOtherNames, samePath, tlsOptionsName } from '../utils/routes'

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
  // Ask before loading even a trusted project, as `betty project load` does.
  confirmLoad?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

// Control characters (an escape sequence, a carriage return) and bidi overrides
// could make the trust summary show something other than what runs. Commands
// may span lines.
// eslint-disable-next-line no-control-regex
const HIDING_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/u
const assertVisible = (label: string, value: string | undefined, opts: { multiline?: boolean } = {}): void => {
  if (value === undefined) return
  if (HIDING_CHARACTERS.test(value) || (opts.multiline !== true && value.includes('\n'))) throw new Error(`.betty.yml: ${label} contains control characters.`)
}

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
  // The name becomes the route file and router names.
  if (sanitizeName(project) === '') throw new Error(`.betty.yml: project name '${project}' needs at least one letter or digit (a-z, 0-9).`)

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

  assertVisible('project', project)
  domains.forEach((domain, index) => { assertVisible(`domains[${String(index)}].target`, domain.target) })
  assertVisible('up.command', up?.command, { multiline: true })
  assertVisible('down.command', down?.command, { multiline: true })
  assertVisible('https.certificateAuthority', https?.certificateAuthority)

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

  const answer = await prompt([{
    type: 'confirm',
    name: 'ok',
    message,
    default: true,
  }]) as { ok: boolean }
  return answer.ok
}

const PERMISSION_LABELS = { hosts: 'hosts file', trustStore: 'mkcert CA', docker: 'Docker' } as const

interface ConfirmProjectOptions {
  yes?: boolean;
  // The verb in the trust question, e.g. load or link.
  action: string;
  // Asked of a trusted project, which otherwise goes ahead without a question.
  question?: { message: string; default: boolean };
}

// A .betty.yml from a cloned repository could grant itself every permission and
// run any command. Before betty acts on a file it has not seen (or one that
// changed since), the user sees what it does and decides whether to trust it.
// --yes is that decision made up front.
export const confirmProject = async (config: DevProjectConfig, configPath: string, opts: ConfirmProjectOptions): Promise<boolean> => {
  if (opts.yes === true) return true
  if (isProjectTrusted(configPath, config)) {
    if (opts.question === undefined) return true
    const { ok } = await prompt([{ type: 'confirm', name: 'ok', message: opts.question.message, default: opts.question.default }]) as { ok: boolean }
    return ok
  }

  const relPath = path.relative(process.cwd(), configPath) || path.basename(configPath)
  console.log(`\n${relPath} is new to betty or has changed since you last trusted it:`)
  console.log(`  Project: ${config.project}`)
  for (const domain of config.domains) console.log(`  ${domain.host} -> ${domain.target}`)
  if (config.https?.enabled === true) console.log('  HTTPS: certificates from your local mkcert CA')
  // A command over several lines shows every line, indented under its label.
  const showCommand = (label: string, command: string): void => { console.log(`  ${label}: ${command.split('\n').join(`\n${' '.repeat(label.length + 4)}`)}`) }
  if (config.up?.command !== undefined) showCommand('Start command', config.up.command)
  if (config.down?.command !== undefined) showCommand('Stop command', config.down.command)
  const granted = (Object.keys(PERMISSION_LABELS) as (keyof typeof PERMISSION_LABELS)[])
    .filter((key) => config.permissions?.[key] === 'allowed')
    .map((key) => PERMISSION_LABELS[key])
  if (granted.length > 0) console.log(`  Changes without asking: ${granted.join(', ')}`)

  const { ok } = await prompt([{
    type: 'confirm',
    name: 'ok',
    message: `Trust this file and ${opts.action} project '${config.project}'?`,
    default: false,
  }]) as { ok: boolean }
  if (ok) trustProject(configPath, config)
  return ok
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

// Adds the missing entries and removes those of dropped domains (no longer in
// .betty.yml) as permissions.hosts allows, in one hosts edit: a single
// elevation prompt on Windows.
const prepareHosts = async (config: DevProjectConfig, dropped: string[]): Promise<void> => {
  const missing = config.domains.filter((domain) => !hasHostsEntry(domain.host))
  const stale = dropped.filter((domain) => hasHostsEntry(domain))
  if (missing.length === 0 && stale.length === 0) return
  const mode = config.permissions?.hosts ?? 'prompt'

  const leftAlone = (adds: string[], removals: string[]): void => {
    for (const host of adds) {
      printWarn(`Hosts entry was not changed for ${host}.`)
      printHint(`Add manually: 127.0.0.1 ${host} # added by betty`)
    }
    for (const host of removals) {
      printWarn(`${host} is no longer in .betty.yml, but its hosts entry was kept.`)
      printHint(`Remove its line manually: 127.0.0.1 ${host} # added by betty`)
    }
  }

  if (mode === 'allowed') {
    updateHostsEntries(missing.map((domain) => domain.host), stale)
    return
  }

  if (mode === 'manual' || mode === 'denied') {
    leftAlone(missing.map((domain) => domain.host), stale)
    return
  }

  let selected: string[] = []
  if (missing.length === 1) {
    const ok = await confirmPermission(`Add hosts entry for ${missing[0].host}?`, 'prompt')
    selected = ok ? [missing[0].host] : []
  } else if (missing.length > 1) {
    const answer = await prompt([{
      type: 'checkbox',
      name: 'hosts',
      message: 'Add hosts entries for (a = all/none):',
      choices: missing.map((d) => ({ name: d.host, value: d.host, checked: true })),
    }]) as { hosts: string[] }
    selected = answer.hosts
  }
  const removeStale = stale.length > 0 && await confirmPermission(`Remove the hosts entries of domains no longer in .betty.yml (${stale.join(', ')})?`, 'prompt')

  updateHostsEntries(selected, removeStale ? stale : [])
  leftAlone(missing.map((domain) => domain.host).filter((host) => !selected.includes(host)), removeStale ? [] : stale)
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
    const certificate = ensureCertificate(domain.host, { required: true, caVerified: true })
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
  // URI percent-decodes its values, so anything but plain path characters (a
  // space, # or & in a user folder) is encoded.
  const rootCa = (getMkcertRootCaPath() ?? '<mkcert -CAROOT>/rootCA.pem').replace(/[^A-Za-z0-9\-._~/:\\]/gu, (c) => encodeURIComponent(c))
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
    hints: ['Give this project another name in .betty.yml, or run `betty project stop` in the other project first.', `Or remove its links from anywhere: betty project unlink ${config.project}`],
  })
  // Project routers are named <project>-<n>. Anything else in the file means it
  // is a `betty link` route file whose name happens to match the project.
  // Compared like the file system does: on Windows and macOS a link's
  // API-dev.yml is the same file as project api-dev's api-dev.yml.
  const ownRoutes = readRoutes().filter((r) => samePath(r.filePath, ownRouteFile))
  const foreign = ownRoutes.find((r) => !isProjectRouter(r.routerName, config.project))
  if (foreign !== undefined) throw new BettyError(`The route file ${foreign.fileName} already belongs to the link for ${foreign.domain}.`, {
    hints: ['Give this project another name in .betty.yml, or run `betty unlink --domain ' + foreign.domain + '` first.'],
  })
  // After `project:` was renamed in .betty.yml, the routes loaded under the old
  // name belong to this load: they are replaced, not left routed with no
  // command that would ever remove them.
  const renamedFiles = opts.configPath !== undefined ? routeFilesUnderOtherNames(config.project, opts.configPath) : []
  const previousRoutes = [...ownRoutes, ...readRoutes().filter((r) => renamedFiles.some((file) => samePath(file, r.filePath)))]
  for (const domain of config.domains) if (findDomainConflict(domain.host, { filePath: ownRouteFile, alsoFiles: renamedFiles }, true) !== null) throw new Error(`Domain '${domain.host}' is already linked. Run \`betty unlink\` first.`)

  // Browsers open .dev only over HTTPS (HSTS preload); a plain HTTP route there
  // ends in a browser error.
  if (config.https?.enabled !== true) for (const domain of config.domains) if (isHttpsRequestedDomain(domain.host) && !isDatabaseTarget(domain.target)) printWarn(`${domain.host}: browsers open .dev domains only over HTTPS. Set https.enabled: true in .betty.yml.`)

  // Docker first: without it nothing below can be served, so hosts entries and
  // certificates are not created for a project that cannot start.
  const dockerAllowed = await confirmPermission('Run Docker commands for the Betty proxy and project startup?', effectiveConfig.permissions?.docker)
  if (!dockerAllowed) throw new Error('Docker permission was not granted.')
  if (!checkDockerRunning()) throw new Error('Docker is not running or is not available.')

  // Everything that commonly fails (mkcert, a taken port, the proxy) comes
  // before the hosts entries: once those are added, a failure would leave them
  // behind with no route that `betty project stop` could find.
  const certificates = await prepareCertificates(effectiveConfig)
  ensureProxySetup({ certs: true })
  ensureHttpsPortAvailable()
  ensureProxyNetwork()
  ensureProxyRunning(BETTY_PROXY_COMPOSE, 'project load')

  // Domains dropped from .betty.yml since the last load would keep their hosts
  // entries forever: nothing else knows they belonged to this project. Found
  // while the old routes are still known; other links may still need them.
  const kept = new Set(config.domains.map((d) => d.host.toLowerCase()))
  const replaced = [ownRouteFile, ...renamedFiles]
  const linked = new Set(readRoutes().filter((r) => !replaced.some((file) => samePath(file, r.filePath))).map((r) => r.domain.toLowerCase()))
  const dropped = [...new Set(previousRoutes.map((r) => r.domain.toLowerCase()))].filter((d) => d !== '' && !kept.has(d) && !linked.has(d))

  await prepareHosts(effectiveConfig, dropped)
  writeProjectRoute(config.project, config.domains, certificates, config.https?.enabled === true, opts.configPath)
  for (const file of renamedFiles) {
    fs.rmSync(file, { force: true })
    console.log(`Removed the routes of the old project name: ${path.basename(file)}`)
  }

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

    const relPath = path.relative(process.cwd(), configPath) || path.basename(configPath)
    const confirmed = await confirmProject(config, configPath, {
      yes: opts.yes,
      action: opts.confirmLoad === true ? 'load' : 'start',
      question: opts.confirmLoad === true ? { message: `Load project '${config.project}' from ${relPath}?`, default: true } : undefined,
    })
    if (!confirmed) { console.log('Cancelled.'); return }

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
        // Removes the routes and the hosts entries no other link needs, as
        // `betty project stop` would.
        if (fs.existsSync(ownRouteFile)) try {
          await unlinkCommand({ project: sanitizeName(config.project), yes: true })
        } catch (err) {
          printWarn(`Could not remove the project's links: ${err instanceof Error ? err.message : String(err)}`)
          printHint('Remove them with: betty project stop')
        }
        if (config.down?.command !== undefined) try { runProjectCommand(config.down.command, configPath) } catch { /* best-effort */ }
        cleanExit = true
      } else if (result.status !== null && result.status !== 0) throw new BettyError(`Up command exited with code ${String(result.status)}`, {
        hints: ['The domains are still linked. Fix the command and load the project again, or remove the links with: betty project stop'],
      })
    }
    if (!cleanExit) printUrls(config)
  } catch (err) {
    if (err instanceof BettyError) throw err
    throw new BettyError(err instanceof Error ? err.message : String(err))
  }
  if (cleanExit) process.exit(0)
}

export default devCommand
