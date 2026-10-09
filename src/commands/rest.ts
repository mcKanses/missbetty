import inquirer from 'inquirer'
import { execSync } from 'child_process'
import fs from 'fs'
import { BettyError } from '../utils/errors'
import { withLock } from '../utils/lock'
import { BETTY_HOME_DIR, BETTY_PROXY_COMPOSE } from '../utils/constants'

interface RestOptions {
  yes?: boolean;
}

const restCommand = async (opts?: RestOptions): Promise<void> => {
  if (!fs.existsSync(BETTY_PROXY_COMPOSE)) {
    console.log("Betty's local switchboard service is not set up yet.")
    console.log('Start it with: betty serve')
    return
  }

  if (opts?.yes !== true) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Stop Betty proxy service?',
      default: false,
    }]) as { confirm: boolean }
    if (!confirm) { console.log('Cancelled.'); return }
  }

  try {
    console.log("Betty is stopping her local switchboard service...")
    // Under the lock, so the proxy does not go down while another command is
    // between starting it and writing its route.
    withLock(() => {
      execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" down`, {
        cwd: BETTY_HOME_DIR,
        stdio: 'inherit',
      })
    })
    console.log('Betty is resting.')
  } catch (err) {
    if (err instanceof BettyError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new BettyError(`Betty's switchboard service could not be stopped: ${message}`)
  }
}

export default restCommand
