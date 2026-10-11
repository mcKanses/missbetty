import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import { validateDomain } from './names'

// Marker Betty appends to every hosts entry it creates. Removal is gated on this
// marker so Betty never deletes hosts lines a user added manually.
const BETTY_HOSTS_MARKER = '# added by betty'

// sudo and `env -i` drop WSL_DISTRO_NAME, so the kernel name is checked too.
export const isWsl = (): boolean => process.platform === 'linux' &&
  ((process.env.WSL_DISTRO_NAME ?? '').trim() !== '' || /microsoft/i.test(os.release()))

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

// Host names are case-insensitive, as is the elevated script's PowerShell -match.
const domainPattern = (domain: string): RegExp =>
  new RegExp(`(^|\\s)${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i')

// Only the part before `#` maps a host: a disabled line such as
// `# 127.0.0.1 app.test` does not count, and the marker's own words ("added",
// "by", "betty") are valid domains that must not match.
// A UTF-8 byte-order mark reads as these three Latin-1 characters; it is part
// of the first line's bytes, not of its mapping, and is kept when writing.
const BOM = /^(\u00EF\u00BB\u00BF|\uFEFF)/
const activePart = (line: string): string => line.replace(BOM, '').split('#')[0]

// The addresses the file maps a domain to, in file order.
const mappingsOf = (content: string, domain: string): string[] => {
  const pattern = domainPattern(domain)
  return content.split(/\r?\n/)
    .filter((line) => pattern.test(activePart(line)))
    .map((line) => activePart(line).trim().split(/\s+/)[0] ?? '')
}

const isLoopback = (address: string): boolean => address.startsWith('127.') || address === '::1'

// Only a loopback mapping reaches Traefik. A blocklist line (0.0.0.0 app.test) or
// a stale LAN address does not count as an entry.
const containsDomain = (content: string, domain: string): boolean => mappingsOf(content, domain).some(isLoopback)

// A non-loopback mapping listed before Betty's entry wins, as resolvers use the
// first match.
const foreignMapping = (content: string, domain: string): string | undefined => {
  const mappings = mappingsOf(content, domain)
  const first = mappings.length > 0 ? mappings[0] : undefined
  return first !== undefined && !isLoopback(first) ? first : undefined
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

// Read and written as Latin-1, which maps every byte to one character and back.
// Hosts files are often not UTF-8 (ANSI comments on Windows); decoding them as
// UTF-8 would turn such bytes into replacement characters on the next write.
// Domains are ASCII, so matching is unaffected.
const HOSTS_ENCODING = 'latin1'

const readOrNull = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, HOSTS_ENCODING)
  } catch {
    return null
  }
}

// Read-only check against the hosts file Betty writes to (the Windows one under
// WSL). .localhost needs no entry, so it always counts as present.
// A loopback entry behind a mapping to another address does not count: the
// resolver uses the first match.
export const hasHostsEntry = (domain: string): boolean => {
  if (!needsEntry(domain)) return true
  const content = readOrNull(getHostsPath()) ?? ''
  return containsDomain(content, domain) && foreignMapping(content, domain) === undefined
}

// Why a domain has no usable entry, for doctor; undefined when it has one.
export const hostsEntryProblem = (domain: string): string | undefined => {
  if (!needsEntry(domain)) return undefined
  if (domain !== domain.trim() || validateDomain(domain) !== true) return 'not a valid host name; betty does not write it'
  const content = readOrNull(getHostsPath())
  if (content === null) return 'hosts file not readable'
  const other = foreignMapping(content, domain)
  if (other !== undefined) return `mapped to ${other} first`
  return containsDomain(content, domain) ? undefined : 'missing'
}

export interface HostsEdit {
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
  const joined = kept.join(lineEnding(content))
  // The byte-order mark belongs to the file, not to the first line: it stays
  // when that line is removed.
  const bom = BOM.exec(content)?.[0] ?? ''
  const rest = bom !== '' && !joined.startsWith(bom) ? `${bom}${joined}` : joined
  return edit.add.length > 0 ? `${rest}${appendText(rest, edit.add.map(entryFor))}` : rest
}

// Why the elevated script failed, by its exit code: the elevated window closes
// before anyone can read it. No file carries the reason back, since an elevated
// write to a path an unelevated process can predict could be redirected by a
// link planted there. 1 is also a declined UAC prompt, which needs no message.
const ELEVATED_FAILURES: Partial<Record<number, string>> = {
  2: 'access denied (is the hosts file read-only, or guarded by security software?)',
  3: 'the hosts file is in use by another program',
  4: 'unexpected error while editing the hosts file',
}

// Runs the script elevated and passes on its exit code.
const elevateWithPowerShell = (script: string): boolean => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    // Started directly, not through cmd.exe: cmd caps a command line at 8191
    // characters, which a hosts edit for many domains exceeds.
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `$p = Start-Process PowerShell -Verb RunAs -PassThru -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'; exit $p.ExitCode`],
      { stdio: 'inherit' }
    )
    return true
  } catch (err) {
    const reason = ELEVATED_FAILURES[(err as { status?: number }).status ?? 1]
    if (reason !== undefined) console.log(`\n⚠️  The elevated hosts edit failed: ${reason}`)
    return false
  }
}

// PowerShell also ends a single-quoted string at the typographic quotes
// U+2018-U+201B; doubling escapes them like an ASCII quote.
const psString = (value: string): string => `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`

// Applies the edit from one elevated PowerShell (one UAC prompt). Only the domain
// names are passed; the script reads, filters and writes the file itself, so the
// command stays short however large the hosts file is, and changes made while
// the UAC prompt was open are kept. It mirrors applyEdit: Betty-marked lines for
// removed domains go, missing entries are appended in the file's line ending.
// Betty widens no ACL: a lasting Write grant would let any unelevated process
// of the user redirect domains without a prompt.
// Exported for tests, which run it unelevated against a scratch file.
export const hostsEditScript = (hostsPath: string, edit: HostsEdit): string => {
  const list = (domains: string[]): string => `@(${domains.map(psString).join(', ')})`
  // Latin-1 (28591) round-trips every byte, like HOSTS_ENCODING. Without
  // removals only the new lines are appended; the rest of the file is not
  // rewritten.
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `$path = ${psString(hostsPath)}`,
    `$marker = ${psString(BETTY_HOSTS_MARKER)}`,
    `$add = ${list(edit.add)}`,
    `$remove = ${list(edit.remove)}`,
    '$enc = [System.Text.Encoding]::GetEncoding(28591)',
    'function Test-Maps($line, $domain) { ($line -split "#", 2)[0] -match ("(^|\\s)" + [regex]::Escape($domain) + "(\\s|$)") }',
    'function Test-Loopback($line, $domain) { (Test-Maps $line $domain) -and (($line -split "#", 2)[0].TrimStart([char]0xEF, [char]0xBB, [char]0xBF).Trim() -match "^(127\\.|::1(\\s|$))") }',
    // From the raw bytes: ReadAllText would detect a byte-order mark and decode
    // the file as UTF-8 despite the Latin-1 encoding given.
    '$text = $enc.GetString([System.IO.File]::ReadAllBytes($path))',
    '$eol = if ($text.Contains("`r`n") -or $text.Length -eq 0) { "`r`n" } else { "`n" }',
    '$kept = @($text -split "`r?`n" | Where-Object { $line = $_; -not ($line.Contains($marker) -and @($remove | Where-Object { Test-Maps $line $_ }).Count -gt 0) })',
    '$new = ""',
    '$added = @()',
    'foreach ($domain in $add) {',
    '  if (@($kept | Where-Object { Test-Loopback $_ $domain }).Count -gt 0 -or $added -contains $domain) { continue }',
    '  $added += $domain',
    '  $new += "127.0.0.1 $domain $marker" + $eol',
    '}',
    'if ($remove.Count -eq 0) {',
    '  if ($new.Length -gt 0) {',
    '    if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $new = $eol + $new }',
    '    [System.IO.File]::AppendAllText($path, $new, $enc)',
    '  }',
    '} else {',
    '  $body = [string]::Join($eol, $kept)',
    '  $bom = [string]::new([char[]](0xEF, 0xBB, 0xBF))',
    '  if ($text.StartsWith($bom) -and -not $body.StartsWith($bom)) { $body = $bom + $body }',
    '  if ($new.Length -gt 0 -and $body.Length -gt 0 -and -not $body.EndsWith("`n")) { $body += $eol }',
    '  [System.IO.File]::WriteAllText($path, $body + $new, $enc)',
    '}',
    '} catch {',
    // .NET methods called from PowerShell wrap their exception.
    '  $e = $_.Exception',
    '  while ($null -ne $e.InnerException) { $e = $e.InnerException }',
    '  if ($e -is [System.UnauthorizedAccessException]) { exit 2 }',
    '  if ($e -is [System.IO.IOException]) { exit 3 }',
    '  exit 4',
    '}',
  ].join('\n')
}

const editHostsElevated = (hostsPath: string, edit: HostsEdit): boolean =>
  elevateWithPowerShell(hostsEditScript(hostsPath, edit))

// Adds and removes Betty's hosts entries in one step: a direct write when
// permitted, otherwise a single elevated write (UAC on Windows, sudo elsewhere).
// Batching keeps multi-domain commands at one prompt, and a declined prompt
// leaves the file untouched instead of half-updated.
// Only valid host names reach the file or the elevated script: a route file can
// be edited by hand, and its Host() value must not inject lines or code.
const writable = (domain: string): boolean => needsEntry(domain) && domain === domain.trim() && validateDomain(domain) === true

const editHosts = (add: string[], remove: string[]): boolean => {
  for (const domain of [...add, ...remove]) if (needsEntry(domain) && !writable(domain)) console.log(`\n⚠️  Skipped hosts entry for '${domain}': not a valid host name.`)
  // Host names ignore case: one entry per name, however it was spelled.
  const unique = (domains: string[]): string[] => domains.filter((d, i) => domains.findIndex((o) => o.toLowerCase() === d.toLowerCase()) === i)
  const requested: HostsEdit = { add: unique(add.filter(writable)), remove: unique(remove.filter(writable)) }
  if (requested.add.length === 0 && requested.remove.length === 0) return true
  const hostsPath = getHostsPath()
  const content = readOrNull(hostsPath)

  // An unreadable file cannot be filtered, so its removals go to the manual
  // hint; additions can still be appended.
  const unknownRemovals = content === null ? requested.remove : []
  const edit = content !== null ? pendingEdit(content, requested.add, requested.remove) : { add: requested.add, remove: [] }
  const hasWork = edit.add.length > 0 || edit.remove.length > 0
  if (content !== null) for (const domain of requested.add) {
    const other = foreignMapping(content, domain)
    if (other !== undefined) console.log(`\n⚠️  ${domain} is also mapped to ${other} in ${hostsPath}, before Betty's entry. Remove that line, or the domain will not reach Betty.`)
  }
  if (!hasWork && unknownRemovals.length === 0) return true

  const appendOnly = edit.remove.length === 0
  // Whether the file ends with a line break is unknown when it could not be
  // read, so the new lines start on a line of their own.
  const appended = (): string => content !== null
    ? appendText(content, edit.add.map(entryFor))
    : `${lineEnding('')}${appendText('', edit.add.map(entryFor))}`
  const applied = (): boolean => {
    const after = readOrNull(hostsPath)
    if (after === null) return false
    const left = pendingEdit(after, edit.add, edit.remove)
    return left.add.length === 0 && left.remove.length === 0
  }

  const writeDirect = (): boolean => {
    try {
      // Appending touches only the new lines; a removal has to rewrite the file.
      if (appendOnly) fs.appendFileSync(hostsPath, appended(), HOSTS_ENCODING)
      else fs.writeFileSync(hostsPath, applyEdit(content ?? '', edit), HOSTS_ENCODING)
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
      // A rewrite asks for the password first (sudo -v) and then re-reads the
      // file, so changes made while the prompt was open are not overwritten.
      let input: string
      if (appendOnly) input = appended()
      else {
        execFileSync('sudo', ['-v'], { stdio: 'inherit' })
        // Rewriting from an unread file would empty /etc/hosts.
        const fresh = readOrNull(hostsPath)
        if (fresh === null) return false
        input = applyEdit(fresh, pendingEdit(fresh, edit.add, edit.remove))
      }
      const data = Buffer.from(input, HOSTS_ENCODING)
      const options = { input: data, stdio: ['pipe', 'ignore', 'inherit'] as ('pipe' | 'ignore' | 'inherit')[] }
      if (appendOnly) execFileSync('sudo', ['tee', '-a', hostsPath], options)
      else {
        // The rewrite must not prompt: a prompt would leave time to change the
        // file again. Only with timestamp_timeout=0, where sudo -v caches
        // nothing, does it ask once more.
        let cached = true
        try {
          execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' })
        } catch {
          cached = false
        }
        execFileSync('sudo', cached ? ['-n', 'tee', hostsPath] : ['tee', hostsPath], options)
      }
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

// Adds and removes in one edit: a single elevation prompt on Windows.
export const updateHostsEntries = (add: string[], remove: string[]): boolean => editHosts(add, remove)

export const removeHostsEntries = (domains: string[]): boolean => editHosts([], domains)

export const ensureHostsEntry = (domain: string): boolean => ensureHostsEntries([domain])

export const removeHostsEntry = (domain: string): boolean => removeHostsEntries([domain])
