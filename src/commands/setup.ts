import inquirer from 'inquirer'
import {
  addHostsEntry,
  checkMkcertCaInstalled,
  checkMkcertInstalled,
  collectSetupStatus,
  installMkcertPackage,
  printDockerInstallInstructions,
  printMkcertInstallInstructions,
  runMkcertInstall,
} from '../utils/setup'

interface SetupOptions {
  fix?: boolean;
}

const askYesNo = async (message: string): Promise<boolean> => {
  const answer = await inquirer.prompt([{
    type: 'confirm',
    name: 'ok',
    message,
    default: true,
  }]) as { ok: boolean }
  return answer.ok
}

const runSetupFix = (): void => {
  const status = collectSetupStatus()

  if (!status.mkcertInstalled) {
    const installResult = installMkcertPackage()
    if (!installResult.ok && installResult.warning !== undefined) {
      console.log(`Warning: ${installResult.warning}`)
      printMkcertInstallInstructions()
    }
  }

  if (checkMkcertInstalled() && (!status.mkcertCaInstalled || !checkMkcertCaInstalled())) {
    const mkcertResult = runMkcertInstall()
    if (!mkcertResult.ok && mkcertResult.warning !== undefined) console.log(`Warning: ${mkcertResult.warning}`)
  }

  if (!status.hostsEntryExists) console.log(`Warning: hosts entry missing for ${status.domain}. Run 'betty setup' to confirm sudo append.`)

  if (!status.dockerInstalled) printDockerInstallInstructions()
  else if (!status.dockerRunning) console.log('Warning: Docker is installed but not running.')
}

const runSetupInteractive = async (): Promise<void> => {
  const status = collectSetupStatus()

  if (!status.mkcertInstalled) {
    const shouldInstallMkcert = await askYesNo('mkcert is missing. Install mkcert automatically now? [Y/n]')
    if (shouldInstallMkcert) {
      const installResult = installMkcertPackage()
      if (!installResult.ok && installResult.warning !== undefined) {
        console.log(`Warning: ${installResult.warning}`)
        printMkcertInstallInstructions()
      }
    } else printMkcertInstallInstructions()
  }

  if (checkMkcertInstalled() && (!status.mkcertCaInstalled || !checkMkcertCaInstalled())) {
    const shouldInstallCa = await askYesNo('Run mkcert -install to create local CA? [Y/n]')
    if (shouldInstallCa) {
      const mkcertResult = runMkcertInstall()
      if (!mkcertResult.ok && mkcertResult.warning !== undefined) console.log(`Warning: ${mkcertResult.warning}`)
    }
  }

  if (!status.hostsEntryExists) {
    const shouldAddHosts = await askYesNo(`Add ${status.domain} to /etc/hosts? Requires sudo. [Y/n]`)
    if (shouldAddHosts) {
      const hostsResult = addHostsEntry(status.domain)
      if (!hostsResult.changed && hostsResult.warning !== undefined) console.log(`Warning: ${hostsResult.warning}`)
      if (hostsResult.changed) console.log(`Added hosts entry for ${status.domain}.`)
    }
  }

  if (!status.dockerInstalled) printDockerInstallInstructions()
  else if (!status.dockerRunning) console.log('Docker is installed but not running.')
}

const setupCommand = async (opts?: SetupOptions): Promise<void> => {
  if (opts?.fix === true) {
    runSetupFix()
    return
  }

  await runSetupInteractive()
}

export default setupCommand