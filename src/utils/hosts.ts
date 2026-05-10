import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getHostsPath = (): string => process.platform === 'win32'
  ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  : '/etc/hosts'

const elevateWithPowerShell = (script: string, prefix: string): boolean => {
  const scriptPath = path.join(os.tmpdir(), `betty-hosts-${prefix}-${String(Date.now())}.ps1`)
  fs.writeFileSync(scriptPath, script, 'utf8')
  try {
    execSync(
      `powershell -NoProfile -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -Wait"`,
      { stdio: 'inherit' }
    )
    return true
  } catch {
    return false
  } finally {
    try { fs.unlinkSync(scriptPath) } catch { /* ignore cleanup errors */ }
  }
}

export const ensureHostsEntry = (domain: string): boolean => {
  if (domain.toLowerCase().endsWith('.localhost')) return true

  const hostsPath = getHostsPath()
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = `127.0.0.1 ${domain} # added by betty`
  const hasEntry = (): boolean => {
    const content = fs.readFileSync(hostsPath, 'utf8')
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content)
  }

  try {
    if (hasEntry()) return true
  } catch {
    // continue to append attempt or manual hint
  }

  try {
    fs.appendFileSync(hostsPath, `\n${entry}\n`, 'utf8')
    console.log(`Added hosts entry: ${entry}`)
    return true
  } catch {
    if (process.platform === 'win32') {
      const scriptDomain = domain.replace(/'/g, "''")
      const scriptEntry = entry.replace(/'/g, "''")
      const script = [
        "$ErrorActionPreference = 'Stop'",
        `$domain = '${scriptDomain}'`,
        `$entry = '${scriptEntry}'`,
        "$hostsPath = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'",
        "$content = [System.IO.File]::ReadAllText($hostsPath)",
        "if ($content -match ('(?m)(^|\\s)' + [regex]::Escape($domain) + '(\\s|$)')) { exit 0 }",
        "[System.IO.File]::AppendAllText($hostsPath, \"`r`n$entry`r`n\", [System.Text.Encoding]::UTF8)",
      ].join('\n')

      const elevated = elevateWithPowerShell(script, 'append')
      if (elevated) return hasEntry()
    }
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
    const kept = lines.filter((line) => !domainRegex.test(line))
    return {
      nextContent: `${kept.join('\n')}\n`,
      removed: kept.length !== lines.length,
    }
  }

  try {
    const content = fs.readFileSync(hostsPath, 'utf8')
    const { nextContent, removed } = removeLines(content)
    if (!removed) return true
    fs.writeFileSync(hostsPath, nextContent, 'utf8')
    console.log(`Removed hosts entry for: ${domain}`)
    return true
  } catch {
    if (process.platform === 'win32') {
      const scriptDomain = domain.replace(/'/g, "''")
      const script = [
        "$ErrorActionPreference = 'Stop'",
        `$domain = '${scriptDomain}'`,
        "$hostsPath = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'",
        "$pattern = '(^|\\s)' + [regex]::Escape($domain) + '(\\s|$)'",
        "$lines = [System.IO.File]::ReadAllLines($hostsPath)",
        "$kept = $lines | Where-Object { $_ -notmatch $pattern }",
        "if ($kept.Count -eq $lines.Count) { exit 0 }",
        "[System.IO.File]::WriteAllLines($hostsPath, $kept, [System.Text.Encoding]::UTF8)",
      ].join('\n')

      const elevated = elevateWithPowerShell(script, 'remove')
      if (elevated) return true
    }
  }

  console.log(`\n⚠️  Could not remove hosts entry automatically.`)
  console.log(`   Remove this domain manually from ${hostsPath}: ${domain}`)
  return false
}
