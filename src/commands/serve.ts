import { execSync } from 'child_process'
import {
  BETTY_HOME_DIR,
  BETTY_TRAEFIK_CONTAINER,
  BETTY_PROXY_COMPOSE,
} from '../utils/constants'
import { ensureHttpsPortAvailable, ensureProxySetup, ensureProxyNetwork, printProxyStartError } from '../utils/proxy'

const serveCommand = (): void => {
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
    const message = err instanceof Error ? err.message : String(err)
    printProxyStartError(message, 'serve')
    process.exit(1)
  }
}

export default serveCommand
