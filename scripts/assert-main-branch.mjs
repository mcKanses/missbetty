import { readFileSync } from 'fs'
import { join } from 'path'

const readCurrentBranch = () => {
  const head = readFileSync(join(process.cwd(), '.git', 'HEAD'), 'utf8').trim()
  const prefix = 'ref: refs/heads/'

  return head.startsWith(prefix) ? head.slice(prefix.length) : ''
}

const branch = readCurrentBranch()

if (branch !== 'main') {
  console.error(`Release versioning must run on main. Current branch: ${branch || 'unknown'}`)
  process.exit(1)
}
