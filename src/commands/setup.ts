import { execFileSync } from 'child_process'
import inquirer from 'inquirer'
import { checkAllCertificates, renewCertificates } from '../utils/certs'
import { BETTY_PROXY_COMPOSE, BETTY_TRAEFIK_CONTAINER } from '../utils/constants'
import { restartTraefik } from '../utils/docker'
import { ensureHostsEntries } from '../utils/hosts'
import { withLock } from '../utils/lock'
import {
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
  yes?: boolean;
}

const askYesNo = async (message: string, yes?: boolean): Promise<boolean> => {
  if (yes === true) return true
  const answer = await inquirer.prompt([{
    type: 'confirm',
    name: 'ok',
    message,
    default: true,
  }]) as { ok: boolean }
  return answer.ok
}

// Renews the certificates that expire soon or come from another CA, and
// restarts a running proxy so it serves them: it does not reload certificate
// files on its own.
const renewDueCertificates = (): void => {
  const renewed = withLock(() => renewCertificates(checkAllCertificates()))
  if (renewed.length === 0) return
  let proxyRunning = false
  try {
    proxyRunning = execFileSync('docker', ['ps', '--filter', `name=^${BETTY_TRAEFIK_CONTAINER}$`, '--format', '{{.Names}}'], { stdio: 'pipe' }).toString().trim() !== ''
  } catch { /* Docker is not running: the proxy reads them when it starts */ }
  if (proxyRunning) restartTraefik(BETTY_PROXY_COMPOSE)
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

  // mkcert -install is idempotent and is the only check that the CA is trusted,
  // not just created: it installs it where it is missing.
  if (checkMkcertInstalled()) {
    const mkcertResult = runMkcertInstall()
    if (!mkcertResult.ok && mkcertResult.warning !== undefined) console.log(`Warning: ${mkcertResult.warning}`)
    renewDueCertificates()
  }

  if (!status.hostsEntryExists) console.log(`Warning: hosts entries missing for ${status.missingHostsEntries.join(', ')}. Run 'betty setup' to add them.`)

  if (!status.dockerInstalled) printDockerInstallInstructions()
  else if (!status.dockerRunning) console.log('Warning: Docker is installed but not running.')
}

const runSetupInteractive = async (yes?: boolean): Promise<void> => {
  const status = collectSetupStatus()

  if (!status.mkcertInstalled) {
    const shouldInstallMkcert = await askYesNo('mkcert is missing. Install mkcert automatically now? [Y/n]', yes)
    if (shouldInstallMkcert) {
      const installResult = installMkcertPackage()
      if (!installResult.ok && installResult.warning !== undefined) {
        console.log(`Warning: ${installResult.warning}`)
        printMkcertInstallInstructions()
      }
    } else printMkcertInstallInstructions()
  }

  if (checkMkcertInstalled()) {
    // A created CA may still be untrusted (declined prompt, plain `mkcert <host>`).
    // mkcert -install only acts where it is missing, so it runs unasked then.
    const caCreated = status.mkcertCaInstalled && checkMkcertCaInstalled()
    const shouldInstallCa = caCreated || await askYesNo('Run mkcert -install to create and trust a local CA? [Y/n]', yes)
    if (shouldInstallCa) {
      if (caCreated) console.log('Making sure browsers trust the local CA (mkcert -install)...')
      const mkcertResult = runMkcertInstall()
      if (!mkcertResult.ok && mkcertResult.warning !== undefined) console.log(`Warning: ${mkcertResult.warning}`)
    }
    renewDueCertificates()
  }

  if (!status.hostsEntryExists) {
    const missing = status.missingHostsEntries.join(', ')
    const shouldAddHosts = await askYesNo(`Add hosts entries for ${missing}? This may ask for admin rights. [Y/n]`, yes)
    if (shouldAddHosts) withLock(() => ensureHostsEntries(status.missingHostsEntries))
  }

  if (!status.dockerInstalled) printDockerInstallInstructions()
  else if (!status.dockerRunning) console.log('Docker is installed but not running.')
}

const setupCommand = async (opts?: SetupOptions): Promise<void> => {
  if (opts?.fix === true) {
    runSetupFix()
    return
  }

  await runSetupInteractive(opts?.yes)
}

export default setupCommand