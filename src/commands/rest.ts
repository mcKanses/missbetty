import { execSync } from 'child_process'
import fs from 'fs'
import { printError } from '../cli/ui/output'
import { BETTY_HOME_DIR, BETTY_PROXY_COMPOSE } from '../utils/constants'

const restCommand = (): void => {
  if (!fs.existsSync(BETTY_PROXY_COMPOSE)) {
    console.log("Betty's local switchboard service is not set up yet.")
    console.log('Start it with: betty serve')
    return
  }

  try {
    console.log("Betty is stopping her local switchboard service...")
    execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" down`, {
      cwd: BETTY_HOME_DIR,
      stdio: 'inherit',
    })
    console.log('Betty is resting.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printError(`Betty's switchboard service could not be stopped: ${message}`)
    process.exit(1)
  }
}

export default restCommand
