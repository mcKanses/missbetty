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

// Commands for the installs betty does not update itself.
const MANUAL_UPDATE: Partial<Record<InstallMethod, (version: string) => string>> = {
  pnpm: (v) => `pnpm add -g missbetty@${v}`,
  yarn: (v) => `yarn global add missbetty@${v}`,
  bun: (v) => `bun add -g missbetty@${v}`,
  npx: (v) => `npx missbetty@${v}`,
  source: () => 'git pull && npm run build',
}

// The command to run by hand, or null when betty installs the update itself.
export const manualUpdateCommand = (method: InstallMethod, version: string): string | null => MANUAL_UPDATE[method]?.(version) ?? null

// npm is published after the GitHub release and may lag behind or fail; an npm
// install is only offered a version that is already on npm. Only a 404 says it
// is not: behind a proxy or a company registry, registry.npmjs.org may be out
// of reach while npm itself installs fine, so anything else lets npm try.
export const isOnNpm = async (version: string, timeoutMs = 5000): Promise<boolean> => {
  try {
    const res = await fetch(`https://registry.npmjs.org/missbetty/${version}`, { signal: AbortSignal.timeout(timeoutMs) })
    await res.body?.cancel()
    return res.status !== 404
  } catch {
    return true
  }
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
  const dir = path.win32.dirname(process.execPath)
  const name = path.win32.basename(process.execPath).toLowerCase()
  let leftovers: string[] = []
  try {
    leftovers = fs.readdirSync(dir).filter((file) => file.toLowerCase().startsWith(`${name}.`) && file.toLowerCase().endsWith('.old'))
  } catch { /* unreadable directory: nothing to clean */ }
  // A copy still held by another running betty stays until a later start.
  for (const file of leftovers) try { fs.rmSync(path.win32.join(dir, file), { force: true }) } catch { /* still locked */ }
}

// Ctrl+C reaches both betty and the installer. Without a listener Node would exit
// at once instead of reporting how the installer ended.
const outlastingCtrlC = (run: () => void): void => {
  const ignore = (): void => undefined
  process.on('SIGINT', ignore)
  try {
    run()
  } finally {
    process.off('SIGINT', ignore)
  }
}

const runInstaller = (cmd: string, args: string[], env: NodeJS.ProcessEnv): void => {
  outlastingCtrlC(() => execFileSync(cmd, args, { stdio: 'inherit', env }))
}

const installBinary = async (version: string): Promise<void> => {
  const windows = process.platform === 'win32'
  const platformPath = windows ? path.win32 : path.posix
  const fileName = platformPath.basename(process.execPath)
  const expected = windows ? 'betty.exe' : 'betty'
  // The installer writes betty or betty.exe. Only file systems that ignore case
  // (Windows, macOS by default) make Betty the same file.
  const sameName = windows || process.platform === 'darwin' ? fileName.toLowerCase() === expected : fileName === expected
  if (!sameName) throw new BettyError(`This binary is named ${fileName}; the installer only replaces ${expected}.`, {
    hints: [`Rename it to ${expected}, or install the update with the installer: ${releaseUrl(version)}`],
  })

  const installDir = platformPath.dirname(process.execPath)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BETTY_VERSION: `v${version}`,
    BETTY_SKIP_DEPS: 'true',
    BETTY_SKIP_PATH: 'true',
    BETTY_INSTALL_DIR: installDir,
  }
  // Run by hand without BETTY_INSTALL_DIR, the installer would put a second
  // betty into its default directory instead of replacing this one.
  const defaultDir = windows ? path.win32.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'betty') : '/usr/local/bin'
  const ownDir = windows ? installDir.toLowerCase() !== defaultDir.toLowerCase() : installDir !== defaultDir
  const manualInstall = windows
    ? `${ownDir ? `$env:BETTY_INSTALL_DIR='${installDir.replace(/'/g, "''")}'; ` : ''}irm https://raw.githubusercontent.com/mcKanses/missbetty/main/install.ps1 | iex`
    : `curl -fsSL https://raw.githubusercontent.com/mcKanses/missbetty/main/install.sh | sudo ${ownDir ? `BETTY_INSTALL_DIR='${installDir.replace(/'/g, "'\\''")}' ` : ''}sh`
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
    // The installer has printed its own reason above.
    throw new BettyError('The update did not complete.', {
      hints: [`Run the installer yourself: ${manualInstall}`, `Release: ${releaseUrl(version)}`],
    })
  } finally {
    fs.rmSync(installer.dir, { recursive: true, force: true })
  }
}

// A global npm install lives in npm's global node_modules; anything else is a
// project dependency that npm install -g would not replace. Both sides are
// resolved, since __dirname is a real path and the global root may be a link
// (nvm-windows, fnm), and compared up to a separator.
export const isGlobalNpmInstall = (dir = __dirname): boolean => {
  try {
    const root = fs.realpathSync(execSync('npm root -g', { stdio: 'pipe' }).toString().trim())
    const normalize = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
    return normalize(fs.realpathSync(dir)).startsWith(normalize(root) + path.sep)
  } catch {
    return true
  }
}

export type UpdateRoute = { by: 'betty' } | { by: 'hand'; command: string } | { by: 'later' }

// How this betty gets a version: betty installs it, the user runs a command, or
// not yet, while npm lags the GitHub release. Decided before asking anything, so
// that nobody is asked to install what betty would then refuse.
export const updateRoute = async (version: string, timeoutMs?: number): Promise<UpdateRoute> => {
  const method = installMethod()
  const manual = manualUpdateCommand(method, version)
  if (manual !== null) return { by: 'hand', command: manual }
  if (method === 'npm') {
    if (!isGlobalNpmInstall()) return { by: 'hand', command: `npm install missbetty@${version} (in the project that uses betty)` }
    if (!await isOnNpm(version, timeoutMs)) return { by: 'later' }
  }
  return { by: 'betty' }
}

export const notOnNpmYet = (version: string): BettyError => new BettyError(`Betty ${version} is not on npm yet.`, {
  hints: ['It usually follows the GitHub release within minutes. Try again later.'],
})

export const installUpdate = async (version: string): Promise<void> => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new BettyError(`Invalid version: ${version}`)

  const method = installMethod()
  const manual = manualUpdateCommand(method, version)
  if (manual !== null) throw new BettyError(method === 'source'
    ? 'This betty runs from a source checkout and cannot update itself.'
    : `This betty was installed with ${method} and cannot update itself.`, {
    hints: [`Run: ${manual}`],
  })

  if (method === 'npm') {
    if (!isGlobalNpmInstall()) throw new BettyError('This betty is a project dependency, not a global install.', {
      hints: [`Update it in its project: npm install missbetty@${version}`],
    })
    if (!await isOnNpm(version)) throw notOnNpmYet(version)
    try {
      // Through the shell: npm is a .cmd script on Windows.
      outlastingCtrlC(() => execSync(`npm install -g missbetty@${version}`, { stdio: 'inherit' }))
    } catch {
      // npm has printed its reason above; running the same command again would
      // only fail the same way.
      throw new BettyError('npm could not install the update.', {
        hints: [
          'If npm reported EACCES, the global npm folder needs other permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally',
          'If it reported a busy file (EBUSY/EPERM on Windows), close other betty windows and run: betty update',
        ],
      })
    }
    return
  }

  await installBinary(version)
}
