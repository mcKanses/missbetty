import { getDomainSuffix, getStoredDomainSuffix, setDomainSuffix } from '../utils/config'

const showCurrentConfig = (): void => {
  const stored = getStoredDomainSuffix()
  const effective = getDomainSuffix()
  const envOverride = process.env.BETTY_DOMAIN_SUFFIX

  console.log('Betty config:')
  console.log(`  domainSuffix  ${effective}`)
  if (envOverride !== undefined && envOverride.trim() !== '') console.log(`    source: BETTY_DOMAIN_SUFFIX env var`)
  else if (stored !== null) console.log(`    source: ~/.betty/config.json`)
  else console.log(`    source: default`)
}

const configCommand = (action?: string, key?: string, value?: string): void => {
  if (action === undefined || action === 'list') {
    showCurrentConfig()
    return
  }

  if (action === 'get') {
    if (key !== 'domainSuffix') {
      console.error('Unknown config key. Supported: domainSuffix')
      process.exit(1)
    }

    console.log(getDomainSuffix())
    return
  }

  if (action === 'set') {
    if (key !== 'domainSuffix') {
      console.error('Unknown config key. Supported: domainSuffix')
      process.exit(1)
    }

    if (value === undefined || value.trim() === '') {
      console.error('Missing value. Example: betty config set domainSuffix .localhost')
      process.exit(1)
    }

    try {
      const normalized = setDomainSuffix(value)
      console.log(`Saved: domainSuffix=${normalized}`)
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(message)
      process.exit(1)
    }
  }

  console.error('Usage: betty config [get|set] domainSuffix [value]')
  process.exit(1)
}

export default configCommand
