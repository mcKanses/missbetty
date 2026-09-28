import { execFileSync, execSync } from 'child_process'
import fs from 'fs'

// Marker Betty appends to every hosts entry it creates. Removal is gated on this
// marker so Betty never deletes hosts lines a user added manually.
const BETTY_HOSTS_MARKER = '# added by betty'

export const isWsl = (): boolean => process.platform === 'linux' && (process.env.WSL_DISTRO_NAME ?? '').trim() !== ''

const getHostsPath = (): string => {
  if (process.platform === 'win32') return 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  // Under WSL the browser runs on Windows, so the Windows hosts file (reachable
  // via /mnt/c) is the one that matters.
  if (isWsl()) return '/mnt/c/Windows/System32/drivers/etc/hosts'
  return '/etc/hosts'
}

// .localhost resolves without a hosts entry, so Betty never writes one for it.
const needsEntry = (domain: string): boolean => domain !== '' && !domain.toLowerCase().endsWith('.localhost')

const entryFor = (domain: string): string => `127.0.0.1 ${domain} ${BETTY_HOSTS_MARKER}`

const domainPattern = (domain: string): RegExp =>
  new RegExp(`(^|\\s)${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)

// Only the part before `#` maps a host: a disabled line such as
// `# 127.0.0.1 app.test` does not count, and the marker's own words ("added",
// "by", "betty") are valid domains that must not match.
const activePart = (line: string): string => line.split('#')[0]

const containsDomain = (content: string, domain: string): boolean => {
  const pattern = domainPattern(domain)
  return content.split(/\r?\n/).some((line) => pattern.test(activePart(line)))
}

const isBettyLineFor = (line: string, domain: string): boolean =>
  line.includes(BETTY_HOSTS_MARKER) && domainPattern(domain).test(activePart(line))

// A hosts file keeps its own line endings (CRLF on Windows) and never gains blank
// lines from Betty.
const lineEnding = (content: string): string =>
  content.includes('\r\n') || (content === '' && process.platform === 'win32') ? '\r\n' : '\n'

// Text that appends the given lines on their own lines, in the file's style.
const appendText = (content: string, lines: string[]): string => {
  const eol = lineEnding(content)
  const separator = content === '' || content.endsWith('\n') ? '' : eol
  return `${separator}${lines.map((line) => `${line}${eol}`).join('')}`
}

const readOrNull = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

// Read-only check against the hosts file Betty writes to (the Windows one under
// WSL). .localhost needs no entry, so it always counts as present.
export const hasHostsEntry = (domain: string): boolean => {
  if (!needsEntry(domain)) return true
  return containsDomain(readOrNull(getHostsPath()) ?? '', domain)
}

interface HostsEdit {
  // Entries still missing from the file.
  add: string[];
  // Domains that still have a Betty line in the file.
  remove: string[];
}

const pendingEdit = (content: string, add: string[], remove: string[]): HostsEdit => ({
  add: add.filter((domain) => !containsDomain(content, domain)),
  remove: remove.filter((domain) => content.split(/\r?\n/).some((line) => isBettyLineFor(line, domain))),
})

const applyEdit = (content: string, edit: HostsEdit): string => {
  // Splitting keeps the final empty element, so joining restores the file's
  // trailing line break and line ending without adding one.
  const kept = content.split(/\r?\n/).filter((line) => !edit.remove.some((domain) => isBettyLineFor(line, domain)))
  const rest = kept.join(lineEnding(content))
  return edit.add.length > 0 ? `${rest}${appendText(rest, edit.add.map(entryFor))}` : rest
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

const psString = (value: string): string => `'${value.replace(/'/g, "''")}'`

// Applies the edit from one elevated PowerShell (one UAC prompt). Only the domain
// names are passed; the script reads, filters and writes the file itself, so the
// command stays short however large the hosts file is, and changes made while
// the UAC prompt was open are kept. It mirrors applyEdit: Betty-marked lines for
// removed domains go, missing entries are appended in the file's line ending.
// Betty widens no ACL: a lasting Write grant would let any unelevated process
// of the user redirect domains without a prompt.
const editHostsElevated = (hostsPath: string, edit: HostsEdit): boolean => {
  const list = (domains: string[]): string => `@(${domains.map(psString).join(', ')})`
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$path = ${psString(hostsPath)}`,
    `$marker = ${psString(BETTY_HOSTS_MARKER)}`,
    `$add = ${list(edit.add)}`,
    `$remove = ${list(edit.remove)}`,
    'function Test-Maps($line, $domain) { ($line -split "#", 2)[0] -match ("(^|\\s)" + [regex]::Escape($domain) + "(\\s|$)") }',
    '$text = [System.IO.File]::ReadAllText($path)',
    '$eol = if ($text.Contains("`r`n") -or $text.Length -eq 0) { "`r`n" } else { "`n" }',
    '$kept = @($text -split "`r?`n" | Where-Object { $line = $_; -not ($line.Contains($marker) -and @($remove | Where-Object { Test-Maps $line $_ }).Count -gt 0) })',
    '$body = [string]::Join($eol, $kept)',
    'foreach ($domain in $add) {',
    '  if (@($kept | Where-Object { Test-Maps $_ $domain }).Count -gt 0) { continue }',
    '  if ($body.Length -gt 0 -and -not $body.EndsWith("`n")) { $body += $eol }',
    '  $body += "127.0.0.1 $domain $marker" + $eol',
    '}',
    '[System.IO.File]::WriteAllText($path, $body, (New-Object System.Text.UTF8Encoding $false))',
  ].join('\n')

  return elevateWithPowerShell(script)
}

// Adds and removes Betty's hosts entries in one step: a direct write when
// permitted, otherwise a single elevated write (UAC on Windows, sudo elsewhere).
// Batching keeps multi-domain commands at one prompt, and a declined prompt
// leaves the file untouched instead of half-updated.
const editHosts = (add: string[], remove: string[]): boolean => {
  const requested: HostsEdit = { add: add.filter(needsEntry), remove: remove.filter(needsEntry) }
  if (requested.add.length === 0 && requested.remove.length === 0) return true
  const hostsPath = getHostsPath()
  const content = readOrNull(hostsPath)

  // An unreadable file cannot be filtered, so its removals go to the manual
  // hint; additions can still be appended.
  const unknownRemovals = content === null ? requested.remove : []
  const edit = content !== null ? pendingEdit(content, requested.add, requested.remove) : { add: requested.add, remove: [] }
  const hasWork = edit.add.length > 0 || edit.remove.length > 0
  if (!hasWork && unknownRemovals.length === 0) return true

  const appendOnly = edit.remove.length === 0
  const applied = (): boolean => {
    const after = readOrNull(hostsPath)
    if (after === null) return false
    const left = pendingEdit(after, edit.add, edit.remove)
    return left.add.length === 0 && left.remove.length === 0
  }

  const writeDirect = (): boolean => {
    try {
      // Appending touches only the new lines; a removal has to rewrite the file.
      if (appendOnly) fs.appendFileSync(hostsPath, appendText(content ?? '', edit.add.map(entryFor)), 'utf8')
      else fs.writeFileSync(hostsPath, applyEdit(content ?? '', edit), 'utf8')
      return true
    } catch {
      return false
    }
  }

  const writeElevated = (): boolean => {
    // Elevation can be declined or fail silently; re-read to confirm.
    if (process.platform === 'win32') return editHostsElevated(hostsPath, edit) && applied()
    if (isWsl()) return false
    try {
      // `sudo tee` receives the text on stdin, so nothing passes through a shell.
      // sudo reads its password from the tty.
      const args = appendOnly ? ['tee', '-a', hostsPath] : ['tee', hostsPath]
      const input = appendOnly ? appendText(content ?? '', edit.add.map(entryFor)) : applyEdit(content ?? '', edit)
      execFileSync('sudo', args, { input, stdio: ['pipe', 'ignore', 'inherit'] })
      return applied()
    } catch {
      return false
    }
  }

  const written = !hasWork || writeDirect() || writeElevated()
  if (written) {
    edit.add.forEach((domain) => { console.log(`Added hosts entry: ${entryFor(domain)}`) })
    edit.remove.forEach((domain) => { console.log(`Removed hosts entry for: ${domain}`) })
    if (unknownRemovals.length === 0) return true
  }

  const shownPath = isWsl() ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : hostsPath
  const failedAdds = written ? [] : edit.add
  const failedRemovals = [...(written ? [] : edit.remove), ...unknownRemovals]
  if (failedAdds.length > 0) {
    console.log(isWsl() ? `\n⚠️  WSL detected. Add this line to your Windows hosts file manually:` : `\n⚠️  Could not add hosts entry automatically.`)
    console.log(isWsl() ? `   ${shownPath}` : `   Add this line manually to ${shownPath}:`)
    failedAdds.forEach((domain) => { console.log(`   ${entryFor(domain)}`) })
  }
  if (failedRemovals.length > 0) {
    console.log(`\n⚠️  Could not remove hosts entry automatically.`)
    failedRemovals.forEach((domain) => { console.log(`   Remove this domain manually from ${shownPath}: ${domain}`) })
  }
  return false
}

export const ensureHostsEntries = (domains: string[]): boolean => editHosts(domains, [])

export const removeHostsEntries = (domains: string[]): boolean => editHosts([], domains)

export const ensureHostsEntry = (domain: string): boolean => ensureHostsEntries([domain])

export const removeHostsEntry = (domain: string): boolean => removeHostsEntries([domain])
