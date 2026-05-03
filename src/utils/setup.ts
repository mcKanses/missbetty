import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getDomainSuffix } from './config'

export interface SetupStatus {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  mkcertInstalled: boolean;
  mkcertCaInstalled: boolean;
  hostsEntryExists: boolean;
  domain: string;
}

export interface PlatformInfo {
  isWsl: boolean;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
}

const BETTY_HOME_DIR = path.join(os.homedir(), '.betty')
const BETTY_DYNAMIC_DIR = path.join(BETTY_HOME_DIR, 'dynamic')

export const getPlatformInfo = (): PlatformInfo => {
  const isWsl = process.platform === 'linux' && (process.env.WSL_DISTRO_NAME ?? '').trim() !== ''
  return {
    isWsl,
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
  }
}

const runCheck = (command: string): boolean => {
  try {
    execSync(command, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export const checkDockerInstalled = (): boolean => runCheck('docker --version')

export const checkDockerRunning = (): boolean => {
  if (!checkDockerInstalled()) return false
  return runCheck('docker info')
}

export const checkMkcertInstalled = (): boolean => runCheck('mkcert -help')

const hasCommand = (command: string): boolean => runCheck(`command -v ${command} >/dev/null 2>&1`)

export const checkMkcertCaInstalled = (): boolean => {
  if (!checkMkcertInstalled()) return false
  try {
    const caroot = execSync('mkcert -CAROOT', { stdio: 'pipe' }).toString().trim()
    if (caroot === '') return false
    return fs.existsSync(path.join(caroot, 'rootCA.pem'))
  } catch {
    return false
  }
}

export const isHttpsRequestedDomain = (domain: string): boolean => domain.toLowerCase().endsWith('.dev')

const findLinkedDomainFromDynamic = (): string | null => {
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) return null

  const files = fs.readdirSync(BETTY_DYNAMIC_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))

  for (const file of files) try {
    const content = fs.readFileSync(path.join(BETTY_DYNAMIC_DIR, file), 'utf8')
    const match = /Host\("([^"]+)"\)/.exec(content)
    const domain = match?.[1] ?? ''
    if (domain !== '') return domain
  } catch {
    // Ignore malformed route files.
  }

  return null
}

export const resolveSetupDomain = (): string => {
  const fromLinkedRoute = findLinkedDomainFromDynamic()
  if (fromLinkedRoute !== null) return fromLinkedRoute
  return `betty${getDomainSuffix()}`
}

export const getHostsPath = (): string => {
  if (process.platform === 'win32') return 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  return '/etc/hosts'
}

export const hasHostsEntry = (domain: string): boolean => {
  if (domain.toLowerCase().endsWith('.localhost')) return true
  const hostsPath = getHostsPath()
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    const content = fs.readFileSync(hostsPath, 'utf8')
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content)
  } catch {
    return false
  }
}

export const addHostsEntry = (domain: string): { changed: boolean; warning?: string } => {
  const platform = getPlatformInfo()
  if (domain.toLowerCase().endsWith('.localhost')) return { changed: false }
  if (hasHostsEntry(domain)) return { changed: false }

  const entry = `127.0.0.1 ${domain} # added by betty`
  if (platform.isWsl) return {
      changed: false,
      warning: `WSL detected. Please add this line to your Windows hosts file manually: ${entry}`,
    }

  if (platform.isWindows) return {
      changed: false,
      warning: `Windows detected. Run an elevated editor and add: ${entry}`,
    }

  const escapedEntry = entry.replace(/"/g, '\\"')
  try {
    execSync(`sudo sh -c 'echo "${escapedEntry}" >> /etc/hosts'`, { stdio: 'inherit' })
    if (hasHostsEntry(domain)) return { changed: true }
    return { changed: false, warning: `Could not verify hosts entry for ${domain} after sudo command.` }
  } catch {
    return { changed: false, warning: `Failed to append hosts entry. Add manually: ${entry}` }
  }
}

export const runMkcertInstall = (): { ok: boolean; warning?: string } => {
  if (!checkMkcertInstalled()) return { ok: false, warning: 'mkcert is not installed.' }
  try {
    execSync('mkcert -install', { stdio: 'inherit' })
    if (checkMkcertCaInstalled()) return { ok: true }
    return { ok: false, warning: 'mkcert ran, but the local CA could not be verified.' }
  } catch {
    return { ok: false, warning: 'mkcert -install failed.' }
  }
}

export const installMkcertPackage = (): { ok: boolean; warning?: string } => {
  if (checkMkcertInstalled()) return { ok: true }

  const platform = getPlatformInfo()

  try {
    if (platform.isMac) {
      if (!hasCommand('brew')) return { ok: false, warning: 'Homebrew is not installed. Install Homebrew first, then run betty setup again.' }
      execSync('brew install mkcert', { stdio: 'inherit' })
    } else if (platform.isWindows) {
      if (!runCheck('winget --version')) return { ok: false, warning: 'winget is not available. Install mkcert manually and run betty setup again.' }
      execSync('winget install --id FiloSottile.mkcert -e', { stdio: 'inherit' })
    } else if (platform.isLinux) if (hasCommand('apt-get')) execSync('sudo apt-get install -y mkcert', { stdio: 'inherit' })
      else if (hasCommand('apt')) execSync('sudo apt install -y mkcert', { stdio: 'inherit' })
      else if (hasCommand('pacman')) execSync('sudo pacman -S --noconfirm mkcert', { stdio: 'inherit' })
      else return { ok: false, warning: 'No supported package manager found for automatic mkcert installation.' }
    else return { ok: false, warning: 'Automatic mkcert installation is not supported on this platform.' }
  } catch {
    return { ok: false, warning: 'Automatic mkcert installation failed.' }
  }

  if (checkMkcertInstalled()) return { ok: true }
  return { ok: false, warning: 'mkcert still not found after installation attempt.' }
}

export const collectSetupStatus = (): SetupStatus => {
  const domain = resolveSetupDomain()
  const mkcertInstalled = checkMkcertInstalled()
  return {
    dockerInstalled: checkDockerInstalled(),
    dockerRunning: checkDockerRunning(),
    mkcertInstalled,
    mkcertCaInstalled: mkcertInstalled ? checkMkcertCaInstalled() : false,
    hostsEntryExists: hasHostsEntry(domain),
    domain,
  }
}

export const printMkcertInstallInstructions = (): void => {
  const platform = getPlatformInfo()

  console.log('mkcert is missing.')
  if (platform.isMac) {
    console.log('Install with Homebrew: brew install mkcert')
    return
  }
  if (platform.isWindows) {
    console.log('Install mkcert using winget (optional): winget install FiloSottile.mkcert')
    console.log('Or download from: https://github.com/FiloSottile/mkcert')
    return
  }
  console.log('Install mkcert using your package manager:')
  console.log('- Debian/Ubuntu: sudo apt install mkcert')
  console.log('- Arch: sudo pacman -S mkcert')
}

export const printDockerInstallInstructions = (): void => {
  const platform = getPlatformInfo()

  console.log('Docker is missing.')
  if (platform.isMac) {
    console.log('Install Docker Desktop: brew install --cask docker')
    return
  }
  if (platform.isWindows) {
    console.log('Install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/')
    return
  }
  console.log('Install Docker for Linux using your distro documentation:')
  console.log('https://docs.docker.com/engine/install/')
}