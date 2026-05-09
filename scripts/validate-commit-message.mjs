import fs from 'fs'

const messagePath = process.argv[2]

if (!messagePath) {
  console.error('Missing commit message file path.')
  process.exit(1)
}

const message = fs.readFileSync(messagePath, 'utf8')
const subject = message
  .split(/\r?\n/)
  .find((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  ?.trim() ?? ''

const allowedTypes = [
  'feat',
  'fix',
  'chore',
  'docs',
  'test',
  'refactor',
  'perf',
  'build',
  'ci',
  'style',
  'revert',
]

const pattern = new RegExp(
  `^(${allowedTypes.join('|')})(\\([a-z0-9-]+\\))?!?: \\p{Lu}.+`,
  'u'
)

if (pattern.test(subject)) process.exit(0)

console.error('Invalid commit message.')
console.error('')
console.error('Use a Conventional Commit prefix and start the subject after the colon with an uppercase letter.')
console.error('')
console.error('Examples:')
console.error('  feat: Add project dev orchestrator')
console.error('  fix: Handle missing Docker daemon')
console.error('  chore: Merge development into feature dev orchestrator')
console.error('')
console.error(`Received: ${subject === '' ? '(empty)' : subject}`)
process.exit(1)
