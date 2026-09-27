import {
  BETTY_TRAEFIK_CONTAINER,
  BETTY_PROXY_COMPOSE,
} from '../utils/constants'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, ensureProxyRunning, proxyStartError } from '../utils/proxy'
import { getHttpPort, getHttpsPort } from '../utils/config'
import { BettyError } from '../utils/errors'
import { withLock } from '../utils/lock'

const serveCommand = (): void => { withLock(() => {
  try {
    ensureProxySetup({ certs: true })
    ensureProxyNetwork()
    ensureHttpsPortAvailable()

    console.log('Starting global Betty Traefik proxy...')
    ensureProxyRunning(BETTY_PROXY_COMPOSE, 'serve')
    console.log(`Traefik proxy is running as '${BETTY_TRAEFIK_CONTAINER}' on ports ${String(getHttpPort())} (HTTP) and ${String(getHttpsPort())} (HTTPS).`)
  } catch (err) {
    // BettyError already carries a user-facing message and hints; let it reach
    // the central handler instead of relabeling it as a proxy-start failure.
    if (err instanceof BettyError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw proxyStartError(message, 'serve')
  }
}) }

export default serveCommand
