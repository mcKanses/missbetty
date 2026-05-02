import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import yaml from 'yaml'
import inquirer from 'inquirer'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'

interface RouteEntry {
  filePath: string;
  fileName: string;
  routerName: string;
  domain: string;
  target: string;
}

const BETTY_HOME_DIR = path.join(os.homedir(), '.betty')
const BETTY_PROXY_COMPOSE = path.join(BETTY_HOME_DIR, 'docker-compose.yml')
const BETTY_DYNAMIC_DIR = path.join(BETTY_HOME_DIR, 'dynamic')

const resolveTraefikComposePath = (): string => {
  if (fs.existsSync(BETTY_PROXY_COMPOSE)) return BETTY_PROXY_COMPOSE
  

  console.error("Betty's proxy is not set up yet. Run: betty serve")
  process.exit(1)
}

const readRoutes = (_composePath: string): RouteEntry[] => {
  const dynamicDir = BETTY_DYNAMIC_DIR
  if (!fs.existsSync(dynamicDir)) return []

  const files = fs.readdirSync(dynamicDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))

  return files
    .map((file) => {
      const filePath = path.join(dynamicDir, file)
      try {
        const doc = yaml.parse(fs.readFileSync(filePath, 'utf8')) as TraefikDynamicConfig
        const routers: Record<string, TraefikRouter> = doc.http?.routers ?? {}
        const services: Record<string, TraefikService> = doc.http?.services ?? {}
        const routerKeys = Object.keys(routers)
        const serviceKeys = Object.keys(services)
        const firstRouterKey = routerKeys.find((key) => !key.endsWith('-secure')) ?? (routerKeys.length > 0 ? routerKeys[0] : path.basename(file, path.extname(file)))
        const firstServiceKey = serviceKeys.length > 0 ? serviceKeys[0] : firstRouterKey
        const rule = (routers[firstRouterKey] as TraefikRouter | undefined)?.rule ?? ''
        const domainMatch = /Host\("([^"]+)"\)/.exec(rule)
        const domain = domainMatch?.[1] ?? ''
        const url = (services[firstServiceKey] as TraefikService | undefined)?.loadBalancer?.servers?.[0]?.url ?? ''

        return {
          filePath,
          fileName: file,
          routerName: firstRouterKey,
          domain,
          target: url,
        } satisfies RouteEntry
      } catch {
        return null
      }
    })
    .filter((entry): entry is RouteEntry => entry !== null)
}

const restartTraefik = (composePath: string): void => {
  execSync(`docker compose -f "${composePath}" restart traefik`, {
    cwd: path.dirname(composePath),
    stdio: 'inherit',
  })
  console.log('Restarted Traefik.')
}

const removeHostsEntry = (domain: string): boolean => {
  if (domain === '' || domain.toLowerCase().endsWith('.localhost')) return true

  const hostsPath = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts'
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
      const scriptPath = path.join(os.tmpdir(), `betty-hosts-remove-${String(Date.now())}.ps1`)
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

      fs.writeFileSync(scriptPath, script, 'utf8')
      try {
        execSync(
          `powershell -NoProfile -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -Wait"`,
          { stdio: 'inherit' }
        )
        return true
      } catch {
        // manual hint below
      } finally {
        try {
          fs.unlinkSync(scriptPath)
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  console.log(`\n⚠️  Could not remove hosts entry automatically.`)
  console.log(`   Remove this domain manually from ${hostsPath}: ${domain}`)
  return false
}

interface FindRouteAnswer { selection: string; }
interface ConfirmAnswer { confirm: boolean; }

const findRoute = async (routes: RouteEntry[], target?: string, domain?: string): Promise<RouteEntry> => {
  let matches = routes

  if (target === undefined && domain === undefined) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Which link should be removed?',
        choices: routes.map((r) => ({
          name: `${r.routerName} -> ${r.domain} (${r.target !== '' ? r.target : 'n/a'})`,
          value: r.filePath,
        })),
      },
    ]) as FindRouteAnswer
    const selected = routes.find((r) => r.filePath === answer.selection)
    if (selected !== undefined) return selected
  }

  if (domain !== undefined) matches = matches.filter((r) => r.domain === domain)
   else if (target !== undefined) {
    const normalizedTarget = target.toLowerCase()
    matches = matches.filter((r) => {
      const baseName = path.basename(r.fileName, path.extname(r.fileName)).toLowerCase()
      return (
        baseName === normalizedTarget ||
        r.routerName.toLowerCase() === normalizedTarget ||
        r.domain.toLowerCase() === normalizedTarget
      )
    })
  }

  if (matches.length === 1) return matches[0]

  if (matches.length > 1) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Multiple matches found. Which link should be removed?',
        choices: matches.map((r) => ({
          name: `${r.routerName} -> ${r.domain} (${r.target !== '' ? r.target : 'n/a'})`,
          value: r.filePath,
        })),
      },
    ]) as FindRouteAnswer
    const selected = matches.find((r) => r.filePath === answer.selection)
    if (selected !== undefined) return selected
  }

  if (target !== undefined || domain !== undefined) console.error(`No link found for ${domain !== undefined ? `domain '${domain}'` : `target '${target ?? ''}'`}.`)
   else console.error('No link found.')
  
  process.exit(1)
}

const unlinkCommand = async (target?: string, opts?: { domain?: string }): Promise<void> => {
  const composePath = resolveTraefikComposePath()
  const routes = readRoutes(composePath)

  if (routes.length === 0) {
    console.log('No links found.')
    return
  }

  const route = await findRoute(routes, target, opts?.domain)

  const confirmation = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove link: ${route.routerName} -> ${route.domain}?`,
      default: false,
    },
  ]) as ConfirmAnswer

  if (!confirmation.confirm) {
    console.log('Cancelled.')
    return
  }

  if (!fs.existsSync(route.filePath)) {
    console.error(`Routing file not found: ${route.fileName}`)
    process.exit(1)
  }

  fs.unlinkSync(route.filePath)
  console.log(`Removed routing configuration: ${route.fileName}`)

  const remainingRoutes = readRoutes(composePath)
  const domainStillUsed = remainingRoutes.some((r) => r.domain === route.domain && r.filePath !== route.filePath)
  if (!domainStillUsed) {
    const hostsUpdated = removeHostsEntry(route.domain)
    if (!hostsUpdated) console.log(`Domain still needs manual cleanup in hosts: ${route.domain}`)
  }
   else console.log(`Keeping hosts entry because the domain is still in use: ${route.domain}`)
  

  restartTraefik(composePath)
  console.log(`\n✅ Removed link: ${route.routerName} (${route.domain})`)
}

export default unlinkCommand
