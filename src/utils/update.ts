import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isSea } from 'node:sea'
import { BettyError } from './errors'

const REPO = 'mcKanses/missbetty'
const INSTALLER_BASE = `https://raw.githubusercontent.com/${REPO}/main`

export type InstallMethod = 'binary' | 'npm' | 'source'

export const releaseUrl = (version: string): string => `https://github.com/${REPO}/releases/tag/v${version}`

// The latest published GitHub release. Releases are published only once every
// binary is built and smoke-tested, while npm can be ahead of that, so GitHub
// is the source that is safe to offer for every install method. Read from the
// redirect of releases/latest to its tag rather than the REST API, which allows
// only 60 unauthenticated requests per hour and address.
export const fetchLatestVersion = async (timeoutMs = 5000): Promise<string | null> => {
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': 'betty-cli' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    // An unread body keeps the connection open, and exiting with it open
    // crashes Node on Windows.
    await res.body?.cancel()
    const version = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(res.headers.get('location') ?? '')?.[1]
    return version ?? null
  } catch {
    return null
  }
}

export const isNewer = (candidate: string, current: string): boolean => {
  const a = candidate.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

export const installMethod = (): InstallMethod => {
  if (isSea()) return 'binary'
  return __dirname.split(path.sep).includes('node_modules') ? 'npm' : 'source'
}

const downloadInstaller = async (name: string): Promise<string> => {
  let script: string
  try {
    const res = await fetch(`${INSTALLER_BASE}/${name}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`HTTP ${String(res.status)}`)
    }
    script = await res.text()
  } catch (err) {
    throw new BettyError(`Could not download the installer: ${err instanceof Error ? err.message : String(err)}`)
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'betty-update-')), name)
  fs.writeFileSync(file, script, 'utf8')
  return file
}

// A running .exe cannot be overwritten on Windows, but it can be renamed. The
// leftover is removed on the next start (see cleanupOldBinary).
const oldBinaryPath = (): string => `${process.execPath}.old`

export const cleanupOldBinary = (): void => {
  if (process.platform !== 'win32' || !isSea()) return
  try { fs.rmSync(oldBinaryPath(), { force: true }) } catch { /* still locked: next start */ }
}

const installBinary = async (version: string): Promise<void> => {
  const env = {
    ...process.env,
    BETTY_VERSION: `v${version}`,
    BETTY_SKIP_DEPS: 'true',
    BETTY_INSTALL_DIR: path.dirname(process.execPath),
  }

  if (process.platform === 'win32') {
    const installer = await downloadInstaller('install.ps1')
    // Started from PowerShell 7, the inherited PSModulePath points Windows
    // PowerShell at modules it cannot load (Get-FileHash goes missing), so let
    // it compute its own.
    const windowsEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
    fs.renameSync(process.execPath, oldBinaryPath())
    try {
      execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer], { stdio: 'inherit', env: windowsEnv })
    } catch {
      if (!fs.existsSync(process.execPath)) fs.renameSync(oldBinaryPath(), process.execPath)
      throw new BettyError('The update failed; betty was left unchanged.')
    }
    return
  }

  const installer = await downloadInstaller('install.sh')
  try {
    execFileSync('sh', [installer], { stdio: 'inherit', env })
  } catch {
    throw new BettyError('The update failed; betty was left unchanged.')
  }
}

export const installUpdate = async (version: string): Promise<void> => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new BettyError(`Invalid version: ${version}`)

  const method = installMethod()
  if (method === 'source') throw new BettyError('This betty runs from a source checkout and cannot update itself.', {
    hints: ['Update it with git pull and npm run build.'],
  })

  if (method === 'npm') {
    try {
      // Through the shell: npm is a .cmd script on Windows.
      execSync(`npm install -g missbetty@${version}`, { stdio: 'inherit' })
    } catch {
      throw new BettyError('npm could not install the update.', {
        hints: [`Run it yourself: npm install -g missbetty@${version}`],
      })
    }
    return
  }

  await installBinary(version)
}
