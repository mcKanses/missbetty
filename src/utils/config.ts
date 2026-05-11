import fs from 'fs'
import { BETTY_HOME_DIR, BETTY_CONFIG_PATH } from './constants'

interface BettyConfig {
  domainSuffix?: string;
}
const DEFAULT_DOMAIN_SUFFIX = '.dev'

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
