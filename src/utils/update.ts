import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isSea } from 'node:sea'
import { BettyError } from './errors'

const REPO = 'mcKanses/missbetty'

export type InstallMethod = 'binary' | 'npm' | 'pnpm' | 'yarn' | 'bun' | 'npx' | 'source'

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

const parseVersion = (version: string): { core: number[]; prerelease: boolean } => {
  const [core, ...rest] = version.split('-')
  return { core: core.split('.').map((n) => parseInt(n, 10) || 0), prerelease: rest.length > 0 }
}

// Plain x.y.z comparison; a prerelease (1.10.0-rc.1) is older than its release.
export const isNewer = (candidate: string, current: string): boolean => {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i++) if ((a.core[i] ?? 0) !== (b.core[i] ?? 0)) return (a.core[i] ?? 0) > (b.core[i] ?? 0)
  return b.prerelease && !a.prerelease
}

export const installMethod = (dir = __dirname): InstallMethod => {
  if (isSea()) return 'binary'
  const segments = dir.toLowerCase().split(/[\\/]/)
  if (!segments.includes('node_modules')) return 'source'
  if (segments.includes('_npx')) return 'npx'
  if (segments.some((s) => s === '.pnpm' || s === 'pnpm')) return 'pnpm'
  if (segments.some((s) => s === '.bun')) return 'bun'
  if (segments.some((s) => s === '.yarn' || s === 'yarn')) return 'yarn'
  return 'npm'
}

// Commands for the package managers betty does not drive itself.
const MANUAL_UPDATE: Partial<Record<InstallMethod, (version: string) => string>> = {
  pnpm: (v) => `pnpm add -g missbetty@${v}`,
  yarn: (v) => `yarn global add missbetty@${v}`,
  bun: (v) => `bun add -g missbetty@${v}`,
  npx: (v) => `npx missbetty@${v}`,
}

// The installer of the release being installed, not of main: an unreleased
// installer change must not reach every installed betty at once.
const downloadInstaller = async (version: string, name: string): Promise<{ file: string; dir: string }> => {
  let script: string
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/v${version}/${name}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`HTTP ${String(res.status)}`)
    }
    script = await res.text()
  } catch (err) {
    throw new BettyError(`Could not download the installer: ${err instanceof Error ? err.message : String(err)}`)
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'betty-update-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, script, 'utf8')
  return { file, dir }
}

// On Windows the installer moves the running betty.exe aside (it cannot be
// overwritten while running); the leftover is removed on the next start.
export const cleanupOldBinary = (): void => {
  if (process.platform !== 'win32' || !isSea()) return
  try { fs.rmSync(`${process.execPath}.old`, { force: true }) } catch { /* still locked: next start */ }
}

// Ctrl+C reaches both betty and the installer. Without a listener Node would exit
// at once instead of reporting how the installer ended.
const runInstaller = (cmd: string, args: string[], env: NodeJS.ProcessEnv): void => {
  const ignore = (): void => undefined
  process.on('SIGINT', ignore)
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env })
  } finally {
    process.off('SIGINT', ignore)
  }
}

const installBinary = async (version: string): Promise<void> => {
  const name = path.basename(process.execPath).toLowerCase()
  if (name !== 'betty' && name !== 'betty.exe') throw new BettyError(`This binary is named ${path.basename(process.execPath)}; the installer only replaces betty${process.platform === 'win32' ? '.exe' : ''}.`, {
    hints: [`Rename it to betty${process.platform === 'win32' ? '.exe' : ''}, or install the update with the installer: ${releaseUrl(version)}`],
  })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BETTY_VERSION: `v${version}`,
    BETTY_SKIP_DEPS: 'true',
    BETTY_SKIP_PATH: 'true',
    BETTY_INSTALL_DIR: path.dirname(process.execPath),
  }
  const windows = process.platform === 'win32'
  const installer = await downloadInstaller(version, windows ? 'install.ps1' : 'install.sh')
  try {
    if (windows) {
      // Started from PowerShell 7, the inherited PSModulePath points Windows
      // PowerShell at modules it cannot load (Get-FileHash goes missing), so let
      // it compute its own.
      const windowsEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
      runInstaller('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.file], windowsEnv)
    } else runInstaller('sh', [installer.file], env)
  } catch {
    throw new BettyError('The update failed; betty was left unchanged.')
  } finally {
    fs.rmSync(installer.dir, { recursive: true, force: true })
  }
}

// A global npm install lives below npm's global prefix; anything else under
// node_modules is a project dependency that npm install -g would not replace.
const isGlobalNpmInstall = (): boolean => {
  try {
    const prefix = execSync('npm prefix -g', { stdio: 'pipe' }).toString().trim()
    const normalize = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
    return prefix !== '' && normalize(__dirname).startsWith(normalize(prefix))
  } catch {
    return true
  }
}

export const installUpdate = async (version: string): Promise<void> => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new BettyError(`Invalid version: ${version}`)

  const method = installMethod()
  if (method === 'source') throw new BettyError('This betty runs from a source checkout and cannot update itself.', {
    hints: ['Update it with git pull and npm run build.'],
  })

  const manual = MANUAL_UPDATE[method]
  if (manual !== undefined) throw new BettyError(`This betty was installed with ${method} and cannot update itself.`, {
    hints: [`Run: ${manual(version)}`],
  })

  if (method === 'npm') {
    if (!isGlobalNpmInstall()) throw new BettyError('This betty is a project dependency, not a global install.', {
      hints: [`Update it in its project: npm install missbetty@${version}`],
    })
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
