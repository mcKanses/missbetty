import fs from 'fs'
import { BETTY_HOME_DIR, BETTY_CONFIG_PATH } from './constants'
import { BettyError } from './errors'

interface BettyConfig {
  domainSuffix?: string;
  httpPort?: number;
  httpsPort?: number;
  updateCheck?: boolean;
}
const DEFAULT_DOMAIN_SUFFIX = '.dev'
const DEFAULT_HTTP_PORT = 80
const DEFAULT_HTTPS_PORT = 443

const normalizePort = (value: string | number | undefined): number | null => {
  if (value === undefined || value === '') return null
  // Digits only: parseInt would accept '3000abc' as 3000.
  if (typeof value === 'string' && !/^[0-9]+$/.test(value.trim())) return null
  const port = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

const normalizeDomainSuffix = (value: string): string | null => {
  const normalized = value.trim().toLowerCase()
  if (normalized === '') return null

  const withDot = normalized.startsWith('.') ? normalized : `.${normalized}`
  if (/^\.[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(withDot)) return withDot
  return null
}

// The settings in config.json, each kept only with the expected type: a
// hand-edited value of the wrong type is ignored instead of crashing betty.
// `broken` is set when the file exists but is not a JSON object.
const loadBettyConfig = (): { config: BettyConfig; broken: boolean } => {
  if (!fs.existsSync(BETTY_CONFIG_PATH)) return { config: {}, broken: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(BETTY_CONFIG_PATH, 'utf8'))
  } catch {
    return { config: {}, broken: true }
  }
  // Valid JSON need not be an object: null, a number or a list hold no settings.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { config: {}, broken: true }
  const raw = parsed as Record<string, unknown>
  const config: BettyConfig = {}
  if (typeof raw.domainSuffix === 'string') config.domainSuffix = raw.domainSuffix
  const httpPort = typeof raw.httpPort === 'number' || typeof raw.httpPort === 'string' ? normalizePort(raw.httpPort) : null
  if (httpPort !== null) config.httpPort = httpPort
  const httpsPort = typeof raw.httpsPort === 'number' || typeof raw.httpsPort === 'string' ? normalizePort(raw.httpsPort) : null
  if (httpsPort !== null) config.httpsPort = httpsPort
  if (typeof raw.updateCheck === 'boolean') config.updateCheck = raw.updateCheck
  return { config, broken: false }
}

const readBettyConfig = (): BettyConfig => loadBettyConfig().config

// Changes one setting. A config.json that does not parse is left alone:
// rewriting it from the settings that could be read would drop all others.
const updateBettyConfig = (change: BettyConfig): void => {
  const { config, broken } = loadBettyConfig()
  if (broken) throw new BettyError(`${BETTY_CONFIG_PATH} is not valid JSON, so betty does not change it.`, {
    hints: ['Fix or delete the file, then run the command again.'],
  })
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  // Written to a temporary file and renamed: an interrupted write must not
  // leave a torn file behind.
  const tmp = `${BETTY_CONFIG_PATH}.${String(process.pid)}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ ...config, ...change }, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, BETTY_CONFIG_PATH)
}

export const getDomainSuffix = (): string => {
  const envSuffix = normalizeDomainSuffix(process.env.BETTY_DOMAIN_SUFFIX ?? '')
  if (envSuffix !== null) return envSuffix

  const config = readBettyConfig()
  const configured = normalizeDomainSuffix(config.domainSuffix ?? '')
  if (configured !== null) return configured

  return DEFAULT_DOMAIN_SUFFIX
}

export const setDomainSuffix = (value: string): string => {
  const normalized = normalizeDomainSuffix(value)
  if (normalized === null) throw new Error('Invalid domain suffix. Example: .dev or .localhost')

  updateBettyConfig({ domainSuffix: normalized })
  return normalized
}

export const getStoredDomainSuffix = (): string | null => {
  const config = readBettyConfig()
  const configured = normalizeDomainSuffix(config.domainSuffix ?? '')
  if (configured === null) return null
  return configured
}

// Parses a TCP port (1-65535) given as text; null for anything else.
export const parsePort = (value: string): number | null => normalizePort(value)

// Host ports Traefik publishes on. Configurable so Betty can coexist with
// another local proxy already holding 80/443. Traefik still listens on 80/443
// inside the container; only the host-side mapping changes. Resolution order:
// env override, then config.json, then the standard defaults.
export const getHttpPort = (): number =>
  normalizePort(process.env.BETTY_HTTP_PORT) ?? normalizePort(readBettyConfig().httpPort) ?? DEFAULT_HTTP_PORT

export const getHttpsPort = (): number =>
  normalizePort(process.env.BETTY_HTTPS_PORT) ?? normalizePort(readBettyConfig().httpsPort) ?? DEFAULT_HTTPS_PORT

// The address a linked domain is reachable at. The port only appears when it
// differs from the protocol default, so standard setups keep clean URLs.
export const domainUrl = (domain: string, https: boolean): string => {
  const port = https ? getHttpsPort() : getHttpPort()
  const defaultPort = https ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT
  return `${https ? 'https' : 'http'}://${domain}${port === defaultPort ? '' : `:${String(port)}`}`
}

// PostgreSQL 17+ clients can open TLS right away (sslnegotiation=direct), so the
// ClientHello carries the host name and Traefik can route by it (HostSNI) on the
// HTTPS entry point. Other database protocols have no such mode.
export const DATABASE_PROTOCOLS = ['postgres:', 'postgresql:']

export const isDatabaseTarget = (target: string): boolean => {
  try {
    return DATABASE_PROTOCOLS.includes(new URL(target).protocol)
  } catch {
    return false
  }
}

// A database domain is reached through the HTTPS entry point. The port is always
// spelled out: database clients default to their own port (5432), not 443.
export const databaseUrl = (domain: string): string => `postgres://${domain}:${String(getHttpsPort())}`

export const setHttpPort = (value: string): number => {
  const port = normalizePort(value)
  if (port === null) throw new Error('Invalid port. Example: betty config set httpPort 8080')
  if (port === getHttpsPort()) throw new Error(`Port ${String(port)} is already the HTTPS port.`)

  updateBettyConfig({ httpPort: port })
  return port
}

// Whether betty looks for a new release once a day and offers to install it.
// BETTY_NO_UPDATE_CHECK turns it off for a shell, e.g. in scripts.
export const getUpdateCheck = (): boolean => {
  const env = (process.env.BETTY_NO_UPDATE_CHECK ?? '').trim().toLowerCase()
  if (env !== '' && env !== '0' && env !== 'false') return false
  return readBettyConfig().updateCheck !== false
}

export const setUpdateCheck = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  if (!['true', 'false', 'on', 'off'].includes(normalized)) throw new Error('Invalid value. Example: betty config set updateCheck false')

  const enabled = normalized === 'true' || normalized === 'on'
  updateBettyConfig({ updateCheck: enabled })
  return enabled
}

export const setHttpsPort = (value: string): number => {
  const port = normalizePort(value)
  if (port === null) throw new Error('Invalid port. Example: betty config set httpsPort 8443')
  if (port === getHttpPort()) throw new Error(`Port ${String(port)} is already the HTTP port.`)

  updateBettyConfig({ httpsPort: port })
  return port
}
