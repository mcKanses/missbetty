import {
  getDomainSuffix,
  getStoredDomainSuffix,
  setDomainSuffix,
  getHttpPort,
  getHttpsPort,
  setHttpPort,
  setHttpsPort,
} from '../utils/config'
import { BettyError } from '../utils/errors'

const SUPPORTED_KEYS = ['domainSuffix', 'httpPort', 'httpsPort']
const SUPPORTED_KEYS_HINT = `Unknown config key. Supported: ${SUPPORTED_KEYS.join(', ')}`

const showCurrentConfig = (): void => {
  const stored = getStoredDomainSuffix()
  const effective = getDomainSuffix()
  const envOverride = process.env.BETTY_DOMAIN_SUFFIX

  console.log('Betty config:')
  console.log(`  domainSuffix  ${effective}`)
  if (envOverride !== undefined && envOverride.trim() !== '') console.log(`    source: BETTY_DOMAIN_SUFFIX env var`)
  else if (stored !== null) console.log(`    source: ~/.betty/config.json`)
  else console.log(`    source: default`)
  console.log(`  httpPort      ${String(getHttpPort())}`)
  console.log(`  httpsPort     ${String(getHttpsPort())}`)
}

const readKey = (key: string): string | null => {
  switch (key) {
    case 'domainSuffix': return getDomainSuffix()
    case 'httpPort': return String(getHttpPort())
    case 'httpsPort': return String(getHttpsPort())
    default: return null
  }
}

const writeKey = (key: string, value: string): string => {
  switch (key) {
    case 'httpPort': return String(setHttpPort(value))
    case 'httpsPort': return String(setHttpsPort(value))
    default: return setDomainSuffix(value)
  }
}

const configCommand = (action?: string, key?: string, value?: string): void => {
  if (action === undefined || action === 'list') {
    showCurrentConfig()
    return
  }

  if (action === 'get') {
    const result = key !== undefined ? readKey(key) : null
    if (result === null) throw new BettyError(SUPPORTED_KEYS_HINT)

    console.log(result)
    return
  }

  if (action === 'set') {
    if (key === undefined || !SUPPORTED_KEYS.includes(key)) throw new BettyError(SUPPORTED_KEYS_HINT)

    if (value === undefined || value.trim() === '') throw new BettyError(`Missing value. Example: betty config set ${key} ${key === 'domainSuffix' ? '.localhost' : '8080'}`)

    try {
      const normalized = writeKey(key, value)
      console.log(`Saved: ${key}=${normalized}`)
      return
    } catch (err) {
      if (err instanceof BettyError) throw err
      throw new BettyError(err instanceof Error ? err.message : String(err))
    }
  }

  throw new BettyError('Usage: betty config [get|set] <key> [value]')
}

export default configCommand
