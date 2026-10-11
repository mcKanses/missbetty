import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getDomainSuffix } from './config'
import { hasHostsEntry, isWsl } from './hosts'
import { readRoutes } from './routes'

export interface SetupStatus {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  mkcertInstalled: boolean;
  mkcertCaInstalled: boolean;
  hostsEntryExists: boolean;
  domain: string;
  // Every linked domain that needs a hosts entry, and those still without one.
  linkedDomains: string[];
  missingHostsEntries: string[];
}

export interface PlatformInfo {
  isWsl: boolean;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
}

export const getPlatformInfo = (): PlatformInfo => {
  return {
    isWsl: isWsl(),
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
  }
}

// A Docker Desktop that is still starting can leave `docker info` hanging; a
// check gives up instead of blocking doctor or setup for good.
const CHECK_TIMEOUT_MS = 15_000

const runCheck = (command: string): boolean => {
  try {
    execSync(command, { stdio: 'pipe', timeout: CHECK_TIMEOUT_MS })
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

// The mkcert root CA file, or null when mkcert or its CA is missing.
export const getMkcertRootCaPath = (): string | null => {
  try {
    const caroot = execSync('mkcert -CAROOT', { stdio: 'pipe', timeout: CHECK_TIMEOUT_MS }).toString().trim()
    if (caroot === '') return null
    const rootCa = path.join(caroot, 'rootCA.pem')
    return fs.existsSync(rootCa) ? rootCa : null
  } catch {
    return null
  }
}

export const checkMkcertCaInstalled = (): boolean => checkMkcertInstalled() && getMkcertRootCaPath() !== null

export const isHttpsRequestedDomain = (domain: string): boolean => domain.toLowerCase().endsWith('.dev')

// Linked domains that need a hosts entry: HTTP and database routes alike, and
// none for .localhost, which resolves on its own.
const linkedDomainsNeedingHosts = (): string[] => [...new Set(readRoutes()
  .map((route) => route.domain.toLowerCase())
  .filter((domain) => domain !== '' && !domain.endsWith('.localhost')))]

export const resolveSetupDomain = (): string => [...linkedDomainsNeedingHosts(), `betty${getDomainSuffix()}`][0]

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

// winget puts a portable mkcert on the PATH of new processes only. Betty reads
// the PATH back from the registry, so the same run finds what it installed.
const refreshWindowsPath = (): void => {
  try {
    const fresh = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
      { stdio: 'pipe', timeout: CHECK_TIMEOUT_MS }
    ).toString().trim()
    if (fresh !== '') process.env.PATH = `${fresh};${process.env.PATH ?? ''}`
  } catch { /* the hint to open a new terminal covers it */ }
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
      refreshWindowsPath()
    } else if (platform.isLinux) if (hasCommand('apt-get')) execSync('sudo apt-get install -y mkcert', { stdio: 'inherit' })
      else if (hasCommand('apt')) execSync('sudo apt install -y mkcert', { stdio: 'inherit' })
      else if (hasCommand('pacman')) execSync('sudo pacman -S --noconfirm mkcert', { stdio: 'inherit' })
      else return { ok: false, warning: 'No supported package manager found for automatic mkcert installation.' }
    else return { ok: false, warning: 'Automatic mkcert installation is not supported on this platform.' }
  } catch {
    return { ok: false, warning: 'Automatic mkcert installation failed.' }
  }

  if (checkMkcertInstalled()) return { ok: true }
  return { ok: false, warning: platform.isWindows
    ? 'mkcert was installed but is not on the PATH of this terminal yet. Open a new terminal and run betty setup again.'
    : 'mkcert still not found after installation attempt.' }
}

// Without a linked domain there is nothing to map. An entry for a placeholder
// domain would belong to no route, and no betty command would ever remove it.
export const findMissingHostsEntries = (linkedDomains = linkedDomainsNeedingHosts()): string[] =>
  linkedDomains.filter((domain) => !hasHostsEntry(domain))

export const collectSetupStatus = (): SetupStatus => {
  const linkedDomains = linkedDomainsNeedingHosts()
  const missingHostsEntries = findMissingHostsEntries(linkedDomains)
  const mkcertInstalled = checkMkcertInstalled()
  return {
    dockerInstalled: checkDockerInstalled(),
    dockerRunning: checkDockerRunning(),
    mkcertInstalled,
    mkcertCaInstalled: mkcertInstalled ? checkMkcertCaInstalled() : false,
    hostsEntryExists: missingHostsEntries.length === 0,
    domain: [...missingHostsEntries, ...linkedDomains, `betty${getDomainSuffix()}`][0],
    linkedDomains,
    missingHostsEntries,
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