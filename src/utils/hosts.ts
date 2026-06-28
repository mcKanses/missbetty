import { execSync } from 'child_process'
import fs from 'fs'

// Marker Betty appends to every hosts entry it creates. Removal is gated on this
// marker so Betty never deletes hosts lines a user added manually.
const BETTY_HOSTS_MARKER = '# added by betty'

const isWsl = (): boolean => process.platform === 'linux' && (process.env.WSL_DISTRO_NAME ?? '').trim() !== ''

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

const grantHostsWritePermission = (hostsPath: string): boolean => {
  const domain = process.env.USERDOMAIN ?? ''
  const user = process.env.USERNAME ?? ''
  if (domain === '' || user === '') return false
  const username = `${domain}\\${user}`

  const escapedUser = username.replace(/'/g, "''")
  const escapedPath = hostsPath.replace(/'/g, "''")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$hostsPath = '${escapedPath}'`,
    "$acl = Get-Acl $hostsPath",
    `$rule = New-Object System.Security.AccessControl.FileSystemAccessRule('${escapedUser}', 'Write', 'Allow')`,
    '$acl.AddAccessRule($rule)',
    'Set-Acl -Path $hostsPath -AclObject $acl',
  ].join('\n')

  return elevateWithPowerShell(script)
}

export const ensureHostsEntry = (domain: string): boolean => {
  if (domain.toLowerCase().endsWith('.localhost')) return true

  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = `127.0.0.1 ${domain} ${BETTY_HOSTS_MARKER}`

  if (isWsl()) {
    // The browser runs on Windows, so the Windows hosts file is what matters.
    // Try to write it directly through the /mnt/c mount; if that isn't writable
    // (the common case without elevation), fall back to manual instructions.
    const winHostsPath = '/mnt/c/Windows/System32/drivers/etc/hosts'
    try {
      const content = fs.readFileSync(winHostsPath, 'utf8')
      if (new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content)) return true
      fs.appendFileSync(winHostsPath, `\n${entry}\n`, 'utf8')
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
  const hasEntry = (): boolean => {
    const content = fs.readFileSync(hostsPath, 'utf8')
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content)
  }

  try {
    if (hasEntry()) return true
  } catch {
    // continue to append attempt or manual hint
  }

  const tryAppend = (): boolean => {
    try {
      fs.appendFileSync(hostsPath, `\n${entry}\n`, 'utf8')
      console.log(`Added hosts entry: ${entry}`)
      return true
    } catch {
      return false
    }
  }

  if (tryAppend()) return true

  if (process.platform === 'win32') {
    if (grantHostsWritePermission(hostsPath) && tryAppend()) return true
  } else try {
    const escapedEntry = entry.replace(/"/g, '\\"')
    execSync(`sudo sh -c 'echo "${escapedEntry}" >> /etc/hosts'`, { stdio: 'inherit' })
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
    const kept = lines.filter((line) => !(domainRegex.test(line) && line.includes(BETTY_HOSTS_MARKER)))
    return {
      nextContent: `${kept.join('\n')}\n`,
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

  if (process.platform === 'win32' && grantHostsWritePermission(hostsPath) && tryRemove()) return true

  console.log(`\n⚠️  Could not remove hosts entry automatically.`)
  console.log(`   Remove this domain manually from ${hostsPath}: ${domain}`)
  return false
}
