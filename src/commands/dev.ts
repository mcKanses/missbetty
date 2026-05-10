import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'
import yaml from 'yaml'
import { printError, printHint, printWarn } from '../cli/ui/output'
import { checkDockerRunning, checkMkcertInstalled, addHostsEntry, hasHostsEntry, runMkcertInstall } from '../utils/setup'
import {
  getDockerPortOwners,
  getSystemPortOwners,
  filterSystemOwnersForBettyPort,
} from '../utils/portOwners'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'
import {
  BETTY_HOME_DIR,
  BETTY_PROXY_COMPOSE,
  BETTY_DYNAMIC_DIR,
  BETTY_CERTS_DIR,
  BETTY_PROXY_NETWORK,
  BETTY_TRAEFIK_CONTAINER,
  TRAEFIK_COMPOSE,
} from '../utils/constants'
import { sanitizeName, certificatePaths } from '../utils/names'

type PermissionMode = 'prompt' | 'allowed' | 'manual' | 'denied'

interface DevDomainConfig {
  host: string;
  target: string;
}

interface DevProjectConfig {
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
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const parsePermission = (value: unknown): PermissionMode | undefined => {
  if (value === undefined) return undefined
  if (value === 'prompt' || value === 'allowed' || value === 'manual' || value === 'denied') return value
  const label = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : 'non-scalar value'
  throw new Error(`Invalid permission mode '${label}'. Use prompt, allowed, manual, or denied.`)
}

const resolveConfigPath = (configPath?: string): string => {
  if (configPath !== undefined) return path.resolve(process.cwd(), configPath)

  const candidates = ['missbetty.yml', 'missbetty.yaml']
  const match = candidates.find((candidate) => fs.existsSync(path.resolve(process.cwd(), candidate)))
  if (match !== undefined) return path.resolve(process.cwd(), match)
  throw new Error('No missbetty.yml found in the current directory.')
}

export const readDevProjectConfig = (configPath: string): DevProjectConfig => {
  const parsed = yaml.parse(fs.readFileSync(configPath, 'utf8')) as unknown
  if (!isRecord(parsed)) throw new Error('missbetty.yml must contain a YAML object.')

  const project = asString(parsed.project)
  if (project === null) throw new Error('missbetty.yml requires a non-empty project name.')

  const domainsRaw = parsed.domains
  if (!Array.isArray(domainsRaw) || domainsRaw.length === 0) throw new Error('missbetty.yml requires at least one domain.')

  const domains = domainsRaw.map((domainRaw, index) => {
    if (!isRecord(domainRaw)) throw new Error(`domains[${String(index)}] must be an object.`)
    const host = asString(domainRaw.host)
    const target = asString(domainRaw.target)
    if (host === null) throw new Error(`domains[${String(index)}].host is required.`)
    if (target === null) throw new Error(`domains[${String(index)}].target is required.`)
    try {
      const url = new URL(target)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
    } catch {
      throw new Error(`domains[${String(index)}].target must be an http(s) URL.`)
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

const ensureProxyFiles = (): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) fs.mkdirSync(BETTY_DYNAMIC_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_PROXY_COMPOSE) || fs.readFileSync(BETTY_PROXY_COMPOSE, 'utf8') !== TRAEFIK_COMPOSE) fs.writeFileSync(BETTY_PROXY_COMPOSE, TRAEFIK_COMPOSE, 'utf8')
}

const ensureHttpsPortAvailable = (): void => {
  const allDockerOwners = getDockerPortOwners(443)
  const bettyOwnsPort = allDockerOwners.some((owner) => owner.startsWith(BETTY_TRAEFIK_CONTAINER))
  const dockerOwners = allDockerOwners.filter((owner) => !owner.startsWith(BETTY_TRAEFIK_CONTAINER))
  if (bettyOwnsPort && dockerOwners.length === 0) return

  const systemOwners = filterSystemOwnersForBettyPort(getSystemPortOwners(443), bettyOwnsPort)
  if (dockerOwners.length === 0 && systemOwners.length === 0) return

  printError('Port 443 is already in use.')
  dockerOwners.forEach((owner) => { printHint(`Docker: ${owner}`) })
  systemOwners.forEach((owner) => { printHint(`Process: ${owner}`) })
  process.exit(1)
}

const ensureProxyRunning = (): void => {
  execSync(`docker network inspect ${BETTY_PROXY_NETWORK}`, { stdio: 'pipe' })
  execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" up -d`, {
    cwd: BETTY_HOME_DIR,
    stdio: 'inherit',
  })
}

const createProxyNetworkIfNeeded = (): void => {
  try {
    execSync(`docker network inspect ${BETTY_PROXY_NETWORK}`, { stdio: 'pipe' })
  } catch {
    execSync(`docker network create ${BETTY_PROXY_NETWORK}`, { stdio: 'inherit' })
  }
}

const targetForTraefik = (target: string): string => {
  const url = new URL(target)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') url.hostname = 'host.docker.internal'
  return url.toString().replace(/\/$/, '')
}

const ensureCertificate = (host: string): { certFile: string; keyFile: string } => {
  const cert = certificatePaths(host)
  if (fs.existsSync(cert.hostPath) && fs.existsSync(cert.keyPath)) return {
      certFile: cert.certFile,
      keyFile: cert.keyFile,
    }

  if (!checkMkcertInstalled()) throw new Error('HTTPS is enabled, but mkcert is not installed. Run `betty setup`.')

  execSync(`mkcert -cert-file "${cert.hostPath}" -key-file "${cert.keyPath}" "${host}"`, {
    cwd: BETTY_CERTS_DIR,
    stdio: 'inherit',
  })
  return { certFile: cert.certFile, keyFile: cert.keyFile }
}

const writeProjectRoute = (
  project: string,
  domains: DevDomainConfig[],
  certificates: Record<string, { certFile: string; keyFile: string }>,
  httpsEnabled: boolean
): void => {
  const routers: Record<string, TraefikRouter> = {}
  const services: Record<string, TraefikService> = {}

  domains.forEach((domain, index) => {
    const name = `${sanitizeName(project)}-${String(index + 1)}`
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

  const config: TraefikDynamicConfig = { http: { routers, services } }
  const certList = Object.values(certificates)
  if (certList.length > 0) config.tls = { certificates: certList }

  fs.writeFileSync(path.join(BETTY_DYNAMIC_DIR, `${sanitizeName(project)}.yml`), yaml.stringify(config), 'utf8')
}

const prepareHosts = async (config: DevProjectConfig): Promise<void> => {
  for (const domain of config.domains) {
    if (hasHostsEntry(domain.host)) continue
    const allowed = await confirmPermission(`Add hosts entry for ${domain.host}?`, config.permissions?.hosts)
    if (!allowed) {
      printWarn(`Hosts entry was not changed for ${domain.host}.`)
      printHint(`Add manually: 127.0.0.1 ${domain.host} # added by betty`)
      continue
    }
    const result = addHostsEntry(domain.host)
    if (result.warning !== undefined) printWarn(result.warning)
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
    certificates[domain.host] = ensureCertificate(domain.host)
  })
  return certificates
}

const runProjectCommand = (command: string, configPath: string): void => {
  execSync(command, {
    cwd: path.dirname(configPath),
    stdio: 'inherit',
  })
}

const printUrls = (config: DevProjectConfig): void => {
  console.log('\nAvailable URLs:')
  config.domains.forEach((domain) => {
    const protocol = config.https?.enabled === true ? 'https' : 'http'
    console.log(`- ${protocol}://${domain.host} -> ${domain.target}`)
  })
}

const devCommand = async (opts: DevCommandOptions): Promise<void> => {
  try {
    const configPath = resolveConfigPath(opts.config)
    const config = readDevProjectConfig(configPath)

    if (opts.dryRun === true) {
      console.log(`Project: ${config.project}`)
      config.domains.forEach((domain) => { console.log(`- ${domain.host} -> ${domain.target}`) })
      if (config.up?.command !== undefined) console.log(`Up: ${config.up.command}`)
      return
    }

    await prepareHosts(config)
    const certificates = await prepareCertificates(config)

    const dockerAllowed = await confirmPermission('Run Docker commands for the Betty proxy and project startup?', config.permissions?.docker)
    if (!dockerAllowed) throw new Error('Docker permission was not granted.')
    if (!checkDockerRunning()) throw new Error('Docker is not running or is not available.')

    ensureProxyFiles()
    ensureHttpsPortAvailable()
    createProxyNetworkIfNeeded()
    ensureProxyRunning()
    writeProjectRoute(config.project, config.domains, certificates, config.https?.enabled === true)
    execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" restart traefik`, {
      cwd: BETTY_HOME_DIR,
      stdio: 'inherit',
    })

    if (config.up?.command !== undefined) runProjectCommand(config.up.command, configPath)
    printUrls(config)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printError(message)
    process.exit(1)
  }
}

export default devCommand
