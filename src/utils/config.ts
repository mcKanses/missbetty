import fs from 'fs'
import { BETTY_HOME_DIR, BETTY_CONFIG_PATH } from './constants'

interface BettyConfig {
  domainSuffix?: string;
  httpPort?: number;
  httpsPort?: number;
}
const DEFAULT_DOMAIN_SUFFIX = '.dev'
const DEFAULT_HTTP_PORT = 80
const DEFAULT_HTTPS_PORT = 443

const normalizePort = (value: string | number | undefined): number | null => {
  if (value === undefined || value === '') return null
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

const readBettyConfig = (): BettyConfig => {
  if (!fs.existsSync(BETTY_CONFIG_PATH)) return {}

  try {
    const raw = fs.readFileSync(BETTY_CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as BettyConfig
    return parsed
  } catch {
    return {}
  }
}

const writeBettyConfig = (config: BettyConfig): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  fs.writeFileSync(BETTY_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
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

  const current = readBettyConfig()
  writeBettyConfig({ ...current, domainSuffix: normalized })
  return normalized
}

export const getStoredDomainSuffix = (): string | null => {
  const config = readBettyConfig()
  const configured = normalizeDomainSuffix(config.domainSuffix ?? '')
  if (configured === null) return null
  return configured
}

// Host ports Traefik publishes on. Configurable so Betty can coexist with
// another local proxy already holding 80/443. Traefik still listens on 80/443
// inside the container; only the host-side mapping changes. Resolution order:
// env override, then config.json, then the standard defaults.
export const getHttpPort = (): number =>
  normalizePort(process.env.BETTY_HTTP_PORT) ?? normalizePort(readBettyConfig().httpPort) ?? DEFAULT_HTTP_PORT

export const getHttpsPort = (): number =>
  normalizePort(process.env.BETTY_HTTPS_PORT) ?? normalizePort(readBettyConfig().httpsPort) ?? DEFAULT_HTTPS_PORT

export const setHttpPort = (value: string): number => {
  const port = normalizePort(value)
  if (port === null) throw new Error('Invalid port. Example: betty config set httpPort 8080')

  const current = readBettyConfig()
  writeBettyConfig({ ...current, httpPort: port })
  return port
}

export const setHttpsPort = (value: string): number => {
  const port = normalizePort(value)
  if (port === null) throw new Error('Invalid port. Example: betty config set httpsPort 8443')

  const current = readBettyConfig()
  writeBettyConfig({ ...current, httpsPort: port })
  return port
}
