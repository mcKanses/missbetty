import inquirer from 'inquirer'
import { BettyError } from '../utils/errors'
import { fetchLatestVersion, installUpdate, isNewer, notOnNpmYet, releaseUrl, updateRoute } from '../utils/update'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: currentVersion } = require('../../package.json') as { version: string }

interface UpdateOptions {
  check?: boolean;
  yes?: boolean;
}

const updateCommand = async (opts: UpdateOptions = {}): Promise<void> => {
  console.log('Checking for updates...')
  const latest = await fetchLatestVersion()
  if (latest === null) throw new BettyError('Could not reach GitHub to check for updates.', {
    hints: ['Check your internet connection and try again.'],
  })

  if (!isNewer(latest, currentVersion)) {
    console.log(`Betty is up to date (${currentVersion}).`)
    return
  }

  console.log(`Betty ${latest} is available (you have ${currentVersion}).`)
  console.log(`What's new: ${releaseUrl(latest)}`)
  if (opts.check === true) return

  const route = await updateRoute(latest)
  if (route.by === 'hand') {
    // --yes asked for the install; a script must not take this for success.
    if (opts.yes === true) throw new BettyError('This betty cannot update itself.', { hints: [`Update with: ${route.command}`] })
    console.log(`Update with: ${route.command}`)
    return
  }
  if (route.by === 'later') throw notOnNpmYet(latest)

  if (opts.yes !== true) {
    // Without a terminal (CI, cron, piped input) the prompt cannot be answered.
    if (!process.stdin.isTTY) throw new BettyError(`Betty ${latest} is available, but there is no terminal to confirm the install.`, {
      hints: ['Run: betty update --yes'],
    })
    const { install } = await inquirer.prompt<{ install: boolean }>([{
      type: 'confirm',
      name: 'install',
      message: `Install betty ${latest} now?`,
      default: true,
    }])
    if (!install) return
  }

  await installUpdate(latest)
  console.log(`\nBetty is updated to ${latest}.`)
}

export default updateCommand
