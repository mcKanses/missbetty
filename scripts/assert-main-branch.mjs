import { execFileSync } from 'child_process'

// Asks git rather than reading .git/HEAD, which is a file, not a directory, in
// a worktree.
const readCurrentBranch = () => {
  try {
    return execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const branch = readCurrentBranch()

if (branch !== 'main') {
  console.error(`Release versioning must run on main. Current branch: ${branch || 'unknown'}`)
  process.exit(1)
}
