import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'
import { getUpdateCheck } from './config'
import { BETTY_HOME_DIR } from './constants'
import { fetchLatestVersion, installMethod, installUpdate, isNewer, releaseUrl, updateRoute } from './update'

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

interface PromptUi {
  rl: { removeListener: (event: 'SIGINT', fn: () => void) => void; once: (event: 'SIGINT', fn: () => void) => void };
  onForceClose: () => void;
  close: () => void;
}

// inquirer answers Ctrl+C by signalling its own process, which on Windows ends
// it at once with exit code 1. The command already succeeded, so close the
// prompt and leave with its status instead. This reaches into inquirer's
// internals; should they change, Ctrl+C behaves as before.
const keepStatusOnCtrlC = (prompt: object): void => {
  const ui = (prompt as { ui?: Partial<PromptUi> }).ui
  if (ui?.rl === undefined || ui.onForceClose === undefined || ui.close === undefined) return
  const { rl, onForceClose } = ui as PromptUi
  rl.removeListener('SIGINT', onForceClose)
  rl.once('SIGINT', () => {
    (ui as PromptUi).close()
    console.log('')
    process.exit(0)
  })
}

// Looks for a new release at most once a day and, at most once a day, offers to
// install it. Runs after a command succeeded: an exit while the lookup is still
// in flight would crash Node on Windows.
export const offerUpdate = async (argv: string[], currentVersion: string): Promise<void> => {
  if (!updateCheckApplies(argv)) return

  const state = readState()
  const now = Date.now()
  // A time in the future (a clock that was set wrong) does not count as recent:
  // it would silence the check until that date.
  const withinDay = (t: number | undefined): boolean => t !== undefined && t <= now && now - t < DAY_MS
  if (withinDay(state.askedAt)) return

  let latest = state.latest ?? null
  if (!withinDay(state.checkedAt)) {
    // A failed lookup counts too: offline or behind a proxy, betty must not
    // wait for it after every command.
    latest = await fetchLatestVersion(LOOKUP_TIMEOUT_MS)
    state.checkedAt = now
    if (latest !== null) state.latest = latest
    writeState(state)
  }
  if (latest === null || !isNewer(latest, currentVersion) || state.skipped === latest) return

  // npx runs whatever version it is asked for; there is nothing to update.
  if (installMethod() === 'npx') return

  // Recorded before anything else: a prompt cancelled with Ctrl+C counts as
  // "Not now", and while npm lags the release the registry is asked again
  // tomorrow, not after every command.
  writeState({ ...state, askedAt: now })
  const route = await updateRoute(latest, LOOKUP_TIMEOUT_MS)
  if (route.by === 'later') return
  console.log(`\nBetty ${latest} is available (you have ${currentVersion}). What's new: ${releaseUrl(latest)}`)

  // Installs betty cannot update itself only get the command.
  if (route.by === 'hand') {
    console.log(`Update with: ${route.command}`)
    return
  }

  const prompt = inquirer.prompt<{ choice: 'install' | 'later' | 'skip' }>([{
    type: 'list',
    name: 'choice',
    message: 'Install it now?',
    choices: [
      { name: 'Yes, install now', value: 'install' },
      { name: 'Not now', value: 'later' },
      { name: 'Skip this version', value: 'skip' },
    ],
  }])
  keepStatusOnCtrlC(prompt)
  const { choice } = await prompt
  if (choice === 'skip') writeState({ ...state, askedAt: now, skipped: latest })
  if (choice !== 'install') {
    if (choice === 'later') console.log('Run `betty update` any time. Turn this off with `betty config set updateCheck false`.')
    return
  }

  await installUpdate(latest)
  console.log(`\nBetty is updated to ${latest}.`)
}
