import fs from 'fs'
import { BETTY_HOME_DIR, BETTY_STATE_PATH } from './constants'

// Betty's authoritative link state in ~/.betty/links.json. For now it tracks the
// source container per route file name, replacing the parsed `# betty-container`
// YAML comment as the primary source (the comment is kept as a read fallback so
// existing route files still resolve). The file is the foundation for richer
// link state (conflict detection, status) in later work.
interface LinkState {
  containers: Record<string, string>;
}

const readState = (): LinkState => {
  try {
    const parsed = JSON.parse(fs.readFileSync(BETTY_STATE_PATH, 'utf8')) as Partial<LinkState>
    return { containers: parsed.containers ?? {} }
  } catch {
    return { containers: {} }
  }
}

const writeState = (state: LinkState): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  fs.writeFileSync(BETTY_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export const getLinkContainer = (fileName: string): string | undefined => readState().containers[fileName]

export const setLinkContainer = (fileName: string, container: string): void => {
  const state = readState()
  state.containers[fileName] = container
  writeState(state)
}

export const removeLinkContainer = (fileName: string): void => {
  const state = readState()
  if (!(fileName in state.containers)) return

  const containers: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.containers)) if (key !== fileName) containers[key] = value
  writeState({ containers })
}
