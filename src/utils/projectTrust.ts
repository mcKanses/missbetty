import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { BETTY_HOME_DIR } from './constants'

// A .betty.yml can grant itself permissions and carries shell commands, so one
// that came with a cloned repository must not act before the user has seen it.
// Betty remembers which files the user trusted, keyed by path, together with a
// fingerprint of what they do: once that changes, the file is asked about again.
const TRUST_PATH = path.join(BETTY_HOME_DIR, 'trusted-projects.json')

// What the fingerprint covers: everything that decides what loading the file
// does on this machine.
export interface TrustedContent {
  project: string;
  up?: { command?: string };
  down?: { command?: string };
  domains: { host: string; target: string }[];
  https?: { enabled?: boolean; certificateAuthority?: string };
  permissions?: { hosts?: string; trustStore?: string; docker?: string };
}

const fingerprint = (config: TrustedContent): string => crypto.createHash('sha256').update(JSON.stringify([
  config.project,
  config.up?.command ?? null,
  config.down?.command ?? null,
  config.domains.map((d) => [d.host.toLowerCase(), d.target]),
  config.https?.enabled ?? null,
  config.https?.certificateAuthority ?? null,
  config.permissions?.hosts ?? null,
  config.permissions?.trustStore ?? null,
  config.permissions?.docker ?? null,
])).digest('hex')

// Matches routes.ts samePath: the same file must not be trusted twice under
// different spellings on case-insensitive file systems.
const trustKey = (configPath: string): string => {
  const resolved = path.resolve(configPath)
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved
}

// A missing or unreadable file trusts nothing; the user is simply asked again.
const readTrusted = (): Record<string, string> => {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(TRUST_PATH, 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

export const isProjectTrusted = (configPath: string, config: TrustedContent): boolean =>
  readTrusted()[trustKey(configPath)] === fingerprint(config)

// Written to a temporary file and renamed, like the update check state.
export const trustProject = (configPath: string, config: TrustedContent): void => {
  const trusted = { ...readTrusted(), [trustKey(configPath)]: fingerprint(config) }
  fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  const tmp = `${TRUST_PATH}.${String(process.pid)}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(trusted, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, TRUST_PATH)
}
