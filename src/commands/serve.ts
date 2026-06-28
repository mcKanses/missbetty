import { execSync } from 'child_process'
import {
  BETTY_HOME_DIR,
  BETTY_TRAEFIK_CONTAINER,
  BETTY_PROXY_COMPOSE,
} from '../utils/constants'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, proxyStartError } from '../utils/proxy'
import { BettyError } from '../utils/errors'
import { withLock } from '../utils/lock'

const serveCommand = (): void => { withLock(() => {
  try {
    ensureProxySetup({ certs: true })
    ensureProxyNetwork()
    ensureHttpsPortAvailable()

    console.log('Starting global Betty Traefik proxy...')
    execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" up -d`, {
      cwd: BETTY_HOME_DIR,
      stdio: 'inherit',
    })
    console.log(`Traefik proxy is running as '${BETTY_TRAEFIK_CONTAINER}' on port 443.`)
  } catch (err) {
    // BettyError already carries a user-facing message and hints; let it reach
    // the central handler instead of relabeling it as a proxy-start failure.
    if (err instanceof BettyError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw proxyStartError(message, 'serve')
  }
}) }

export default serveCommand
