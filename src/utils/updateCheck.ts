import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'
import { getUpdateCheck } from './config'
import { BETTY_HOME_DIR } from './constants'
import { fetchLatestVersion, installMethod, installUpdate, isNewer, isOnNpm, manualUpdateCommand, releaseUrl } from './update'

const STATE_PATH = path.join(BETTY_HOME_DIR, 'update-check.json')
const DAY_MS = 24 * 60 * 60_000
// Short: the check runs after a command has finished, so it delays its exit.
const LOOKUP_TIMEOUT_MS = 1500

interface UpdateCheckState {
  checkedAt?: number;
  latest?: string;
  askedAt?: number;
  skipped?: string;
}

// Anything but the expected shape (a hand-edited or truncated file) starts over.
const readState = (): UpdateCheckState => {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const state = raw as Record<string, unknown>
    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    return { checkedAt: num(state.checkedAt), latest: str(state.latest), askedAt: num(state.askedAt), skipped: str(state.skipped) }
  } catch {
    return {}
  }
}

// Written to a temporary file and renamed: two terminals finishing at once must
// not leave a torn file behind.
const writeState = (state: UpdateCheckState): void => {
  try {
    fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
    const tmp = `${STATE_PATH}.${String(process.pid)}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, STATE_PATH)
  } catch { /* the next run checks again */ }
}

// Arguments after which betty must not ask anything: machine-readable output,
// help and version, --yes (scripts), and the update command itself.
const QUIET_ARGS = ['update', 'help', '--help', '-h', '--version', '-V', '--json', '--format', '-y', '--yes']

export const updateCheckApplies = (argv: string[]): boolean =>
  getUpdateCheck() &&
  process.stdin.isTTY && process.stdout.isTTY &&
  (process.env.CI ?? '') === '' &&
  !argv.slice(2).some((arg) => QUIET_ARGS.includes(arg) || arg.startsWith('--format='))

// Looks for a new release at most once a day and, at most once a day, offers to
// install it. Runs after a command succeeded: an exit while the lookup is still
// in flight would crash Node on Windows.
export const offerUpdate = async (argv: string[], currentVersion: string): Promise<void> => {
  if (!updateCheckApplies(argv)) return

  const state = readState()
  const now = Date.now()
  if (state.askedAt !== undefined && now - state.askedAt < DAY_MS) return

  let latest = state.latest ?? null
  if (state.checkedAt === undefined || now - state.checkedAt >= DAY_MS) {
    // A failed lookup counts too: offline or behind a proxy, betty must not
    // wait for it after every command.
    latest = await fetchLatestVersion(LOOKUP_TIMEOUT_MS)
    state.checkedAt = now
    if (latest !== null) state.latest = latest
    writeState(state)
  }
  if (latest === null || !isNewer(latest, currentVersion) || state.skipped === latest) return

  const method = installMethod()
  // npx runs whatever version it is asked for; there is nothing to update.
  if (method === 'npx') return
  // npm lags the GitHub release; ask again tomorrow rather than offer a version
  // npm install would not find.
  if (method === 'npm' && !await isOnNpm(latest)) return

  // Recorded before asking: a prompt cancelled with Ctrl+C counts as "Not now".
  writeState({ ...state, askedAt: now })
  console.log(`\nBetty ${latest} is available (you have ${currentVersion}). What's new: ${releaseUrl(latest)}`)

  // Installs betty cannot update itself only get the command.
  const manual = manualUpdateCommand(method, latest)
  if (manual !== null) {
    console.log(`Update with: ${manual}`)
    return
  }

  // inquirer answers Ctrl+C by sending SIGINT to the process; the command
  // already succeeded, so leave with its status instead of 130.
  const leave = (): void => {
    console.log('')
    process.exit(0)
  }
  process.once('SIGINT', leave)
  let choice: 'install' | 'later' | 'skip'
  try {
    ({ choice } = await inquirer.prompt<{ choice: 'install' | 'later' | 'skip' }>([{
      type: 'list',
      name: 'choice',
      message: 'Install it now?',
      choices: [
        { name: 'Yes, install now', value: 'install' },
        { name: 'Not now', value: 'later' },
        { name: 'Skip this version', value: 'skip' },
      ],
    }]))
  } finally {
    process.off('SIGINT', leave)
  }
  if (choice === 'skip') writeState({ ...state, askedAt: now, skipped: latest })
  if (choice !== 'install') {
    if (choice === 'later') console.log('Run `betty update` any time. Turn this off with `betty config set updateCheck false`.')
    return
  }

  await installUpdate(latest)
  console.log(`\nBetty is updated to ${latest}.`)
}
