import { execFileSync, execSync } from 'child_process'
import fs from 'fs'

// Marker Betty appends to every hosts entry it creates. Removal is gated on this
// marker so Betty never deletes hosts lines a user added manually.
const BETTY_HOSTS_MARKER = '# added by betty'

export const isWsl = (): boolean => process.platform === 'linux' && (process.env.WSL_DISTRO_NAME ?? '').trim() !== ''

const getHostsPath = (): string => {
  if (process.platform === 'win32') return 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  // Under WSL the browser runs on Windows, so removals must target the Windows
  // hosts file (reachable via /mnt/c) to match where ensureHostsEntry writes.
  if (isWsl()) return '/mnt/c/Windows/System32/drivers/etc/hosts'
  return '/etc/hosts'
}

const elevateWithPowerShell = (script: string): boolean => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    execSync(
      `powershell -NoProfile -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoProfile','-EncodedCommand','${encoded}' -Wait"`,
      { stdio: 'inherit' }
    )
    return true
  } catch {
    return false
  }
}

// Writes the hosts file from one elevated PowerShell (a UAC prompt) instead of
// widening the file's ACL: a lasting Write grant would let any unelevated
// process of the user redirect domains without a prompt. The text travels as
// base64 so no quoting can break the script.
const writeHostsElevated = (hostsPath: string, text: string, mode: 'append' | 'replace'): boolean => {
  const escapedPath = hostsPath.replace(/'/g, "''")
  const encodedText = Buffer.from(text, 'utf8').toString('base64')
  const write = mode === 'append' ? '[System.IO.File]::AppendAllText($path, $text, $encoding)' : '[System.IO.File]::WriteAllText($path, $text, $encoding)'
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$path = '${escapedPath}'`,
    `$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedText}'))`,
    '$encoding = New-Object System.Text.UTF8Encoding $false',
    write,
  ].join('\n')

  return elevateWithPowerShell(script)
}

// True when an active line maps the domain. Text after `#` is a comment, so a
// disabled line like `# 127.0.0.1 app.test` does not count.
const containsDomain = (content: string, domain: string): boolean => {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`)
  return content.split(/\r?\n/).some((line) => pattern.test(line.split('#')[0]))
}

// Read-only check against the hosts file Betty writes to (the Windows one under
// WSL). .localhost needs no entry, so it always counts as present.
export const hasHostsEntry = (domain: string): boolean => {
  if (domain.toLowerCase().endsWith('.localhost')) return true
  try {
    return containsDomain(fs.readFileSync(getHostsPath(), 'utf8'), domain)
  } catch {
    return false
  }
}

// A hosts file keeps its own line endings (CRLF on Windows) and never gains
// blank lines from Betty: add a line break only if the file does not end with
// one, and end the entry with the file's line ending.
const lineEnding = (content: string): string =>
  content.includes('\r\n') || (content === '' && process.platform === 'win32') ? '\r\n' : '\n'

const appendText = (content: string, entry: string): string => {
  const eol = lineEnding(content)
  const separator = content === '' || content.endsWith('\n') ? '' : eol
  return `${separator}${entry}${eol}`
}

const readOrEmpty = (filePath: string): string => {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

export const ensureHostsEntry = (domain: string): boolean => {
  if (domain.toLowerCase().endsWith('.localhost')) return true

  const entry = `127.0.0.1 ${domain} ${BETTY_HOSTS_MARKER}`

  if (isWsl()) {
    // The browser runs on Windows, so the Windows hosts file is what matters.
    // Try to write it directly through the /mnt/c mount; if that isn't writable
    // (the common case without elevation), fall back to manual instructions.
    const winHostsPath = '/mnt/c/Windows/System32/drivers/etc/hosts'
    try {
      const content = fs.readFileSync(winHostsPath, 'utf8')
      if (containsDomain(content, domain)) return true
      fs.appendFileSync(winHostsPath, appendText(content, entry), 'utf8')
      console.log(`Added hosts entry to the Windows hosts file: ${entry}`)
      return true
    } catch {
      console.log(`\n⚠️  WSL detected. Add this line to your Windows hosts file manually:`)
      console.log(`   C:\\Windows\\System32\\drivers\\etc\\hosts`)
      console.log(`   ${entry}`)
      return false
    }
  }

  const hostsPath = getHostsPath()
  const hasEntry = (): boolean => containsDomain(fs.readFileSync(hostsPath, 'utf8'), domain)

  try {
    if (hasEntry()) return true
  } catch {
    // continue to append attempt or manual hint
  }

  const tryAppend = (): boolean => {
    try {
      fs.appendFileSync(hostsPath, appendText(readOrEmpty(hostsPath), entry), 'utf8')
      console.log(`Added hosts entry: ${entry}`)
      return true
    } catch {
      return false
    }
  }

  if (tryAppend()) return true

  if (process.platform === 'win32') {
    // Elevation can be declined or fail silently; re-read to confirm.
    if (writeHostsElevated(hostsPath, appendText(readOrEmpty(hostsPath), entry), 'append') && containsDomain(readOrEmpty(hostsPath), domain)) {
      console.log(`Added hosts entry: ${entry}`)
      return true
    }
  } else try {
    // Pipe the line into `sudo tee` instead of building a shell command, so the
    // entry never passes through a shell. sudo reads its password from the tty.
    execFileSync('sudo', ['tee', '-a', hostsPath], { input: appendText(readOrEmpty(hostsPath), entry), stdio: ['pipe', 'ignore', 'inherit'] })
    if (hasEntry()) return true
  } catch {
    // fall through to manual hint
  }

  console.log(`\n⚠️  Could not add hosts entry automatically.`)
  console.log(`   Add this line manually to ${hostsPath}:`)
  console.log(`   ${entry}`)
  return false
}

export const removeHostsEntry = (domain: string): boolean => {
  if (domain === '' || domain.toLowerCase().endsWith('.localhost')) return true

  const hostsPath = getHostsPath()
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const domainRegex = new RegExp(`(^|\\s)${escaped}(\\s|$)`)

  const removeLines = (content: string): { nextContent: string; removed: boolean } => {
    const lines = content.split(/\r?\n/)
    // Match the domain only in the active part of the line: the marker comment
    // itself contains words ("added", "by", "betty") that are valid domains.
    const kept = lines.filter((line) => !(domainRegex.test(line.split('#')[0]) && line.includes(BETTY_HOSTS_MARKER)))
    // Splitting keeps the final empty element, so joining restores the file's
    // trailing line break and line ending without adding one.
    return {
      nextContent: kept.join(lineEnding(content)),
      removed: kept.length !== lines.length,
    }
  }

  const tryRemove = (): boolean => {
    try {
      const content = fs.readFileSync(hostsPath, 'utf8')
      const { nextContent, removed } = removeLines(content)
      if (!removed) return true
      fs.writeFileSync(hostsPath, nextContent, 'utf8')
      console.log(`Removed hosts entry for: ${domain}`)
      return true
    } catch {
      return false
    }
  }

  if (tryRemove()) return true

  // An unreadable file gives nothing to rewrite, so fall through to the hint.
  // Elevation can be declined or fail silently; re-read to confirm.
  const content = readOrEmpty(hostsPath)
  const removedElevated = process.platform === 'win32' && content !== ''
    && writeHostsElevated(hostsPath, removeLines(content).nextContent, 'replace')
    && !removeLines(readOrEmpty(hostsPath)).removed
  if (removedElevated) {
    console.log(`Removed hosts entry for: ${domain}`)
    return true
  }

  console.log(`\n⚠️  Could not remove hosts entry automatically.`)
  console.log(`   Remove this domain manually from ${hostsPath}: ${domain}`)
  return false
}
