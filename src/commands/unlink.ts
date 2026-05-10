import path from 'path'
import fs from 'fs'
import { printError } from '../cli/ui/output'
import yaml from 'yaml'
import inquirer from 'inquirer'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'
import { BETTY_DYNAMIC_DIR } from '../utils/constants'
import { resolveTraefikComposePath, restartTraefik } from '../utils/docker'
import { removeHostsEntry } from '../utils/hosts'

interface RouteEntry {
  filePath: string;
  fileName: string;
  routerName: string;
  domain: string;
  target: string;
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

interface FindRouteAnswer { selection: string; }
interface ConfirmAnswer { confirm: boolean; }
interface ConfirmAllAnswer { confirmAll: boolean; }

const findRoute = async (routes: RouteEntry[], target?: string, domain?: string): Promise<RouteEntry> => {
  let matches = routes

  if (target === undefined && domain === undefined) {
    if (routes.length === 1) return routes[0]

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

  if (target !== undefined || domain !== undefined) printError(`No link found for ${domain !== undefined ? `domain '${domain}'` : `target '${target ?? ''}'`}.`)
   else printError('No link found.')

  process.exit(1)
}

const unlinkAll = async (composePath: string, routes: RouteEntry[]): Promise<void> => {
  console.log(`\nAbout to remove all ${String(routes.length)} link(s):`)
  for (const r of routes) console.log(`  - ${r.domain} (${r.fileName})`)

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmAll',
      message: `Remove all ${String(routes.length)} link(s)?`,
      default: false,
    },
  ]) as ConfirmAllAnswer

  if (!answer.confirmAll) {
    console.log('Cancelled.')
    return
  }

  const removedDomains: string[] = []
  const failedDomains: string[] = []

  for (const route of routes) {
    if (!fs.existsSync(route.filePath)) {
      printError(`Routing file not found: ${route.fileName}`)
      failedDomains.push(route.domain)
      continue
    }
    fs.unlinkSync(route.filePath)
    removeHostsEntry(route.domain)
    removedDomains.push(route.domain)
  }

  restartTraefik(composePath)

  console.log('\nSummary:')
  for (const d of removedDomains) console.log(`  ✅ removed: ${d}`)
  for (const d of failedDomains) console.log(`  ❌ failed:  ${d}`)
  console.log('- traefik: restarted')
}

const unlinkCommand = async (target?: string, opts?: { domain?: string; all?: boolean }): Promise<void> => {
  const composePath = resolveTraefikComposePath()
  const routes = readRoutes(composePath)

  if (routes.length === 0) {
    console.log('No links found.')
    return
  }

  if (opts?.all === true) {
    await unlinkAll(composePath, routes)
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
    printError(`Routing file not found: ${route.fileName}`)
    process.exit(1)
  }

  fs.unlinkSync(route.filePath)
  console.log(`Removed routing configuration: ${route.fileName}`)

  const remainingRoutes = readRoutes(composePath)
  const domainStillUsed = remainingRoutes.some((r) => r.domain === route.domain && r.filePath !== route.filePath)
  let hostsStatus: string
  if (!domainStillUsed) {
    const hostsUpdated = removeHostsEntry(route.domain)
    if (!hostsUpdated) console.log(`Domain still needs manual cleanup in hosts: ${route.domain}`)
    hostsStatus = hostsUpdated ? 'removed/ok' : 'manual action required'
  }
   else {
    console.log(`Keeping hosts entry because the domain is still in use: ${route.domain}`)
    hostsStatus = 'kept (domain still used)'
  }

  restartTraefik(composePath)

  console.log('\nSummary:')
  console.log(`- removed domain: ${route.domain}`)
  console.log(`- removed route: ${route.fileName}`)
  console.log(`- hosts: ${hostsStatus}`)
  console.log('- traefik: restarted')

  console.log(`\n✅ Removed link: ${route.routerName} (${route.domain})`)
}

export default unlinkCommand
