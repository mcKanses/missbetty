import fs from 'fs'
import path from 'path'
import yaml from 'yaml'
import { printError } from '../cli/ui/output'
import inquirer from 'inquirer'
import { resolveTraefikComposePath, restartTraefik } from '../utils/docker'
import { removeHostsEntry } from '../utils/hosts'
import { readRoutes, type RouteEntry } from '../utils/routes'
import type { TraefikDynamicConfig } from '../types'

interface FindRouteAnswer { selection: string; }
interface ConfirmAnswer { confirm: boolean; }
interface ConfirmAllAnswer { confirmAll: boolean; }

const removeSingleRoute = (route: RouteEntry): boolean => {
  const doc = yaml.parse(fs.readFileSync(route.filePath, 'utf8')) as TraefikDynamicConfig

  if (doc.http?.routers !== undefined) {
    const secureKey = `${route.routerName}-secure`
    doc.http.routers = Object.fromEntries(
      Object.entries(doc.http.routers).filter(([k]) => k !== route.routerName && k !== secureKey)
    )
  }
  if (doc.http?.services !== undefined) doc.http.services = Object.fromEntries(
    Object.entries(doc.http.services).filter(([k]) => k !== route.routerName)
  )

  if (doc.tls?.certificates !== undefined) {
    doc.tls.certificates = doc.tls.certificates.filter((c) => !c.certFile.includes(route.domain))
    if (doc.tls.certificates.length === 0) delete doc.tls
  }

  const hasRouters = doc.http?.routers !== undefined && Object.keys(doc.http.routers).length > 0
  if (!hasRouters) {
    fs.unlinkSync(route.filePath)
    return true
  }

  fs.writeFileSync(route.filePath, yaml.stringify(doc), 'utf8')
  return false
}

const findRoute = async (routes: RouteEntry[], target?: string, domain?: string, autoSelect = false): Promise<RouteEntry> => {
  let matches = routes

  if (target === undefined && domain === undefined) {
    if (routes.length === 1) return routes[0]

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Which link should be removed?',
        choices: routes.map((r, i) => ({
          name: `${r.domain} (${r.target !== '' ? r.target : 'n/a'})`,
          value: String(i),
        })),
      },
    ]) as FindRouteAnswer
    const selected = routes[parseInt(answer.selection, 10)] as RouteEntry | undefined
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
    if (autoSelect) return matches[0]
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Multiple matches found. Which link should be removed?',
        choices: matches.map((r, i) => ({
          name: `${r.domain} (${r.target !== '' ? r.target : 'n/a'})`,
          value: String(i),
        })),
      },
    ]) as FindRouteAnswer
    const selected = matches[parseInt(answer.selection, 10)] as RouteEntry | undefined
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
  const deletedFiles = new Set<string>()

  for (const route of routes) {
    if (deletedFiles.has(route.filePath)) {
      removeHostsEntry(route.domain)
      removedDomains.push(route.domain)
      continue
    }
    if (!fs.existsSync(route.filePath)) {
      printError(`Routing file not found: ${route.fileName}`)
      failedDomains.push(route.domain)
      continue
    }
    fs.unlinkSync(route.filePath)
    deletedFiles.add(route.filePath)
    removeHostsEntry(route.domain)
    removedDomains.push(route.domain)
  }

  restartTraefik(composePath)

  console.log('\nSummary:')
  for (const d of removedDomains) console.log(`  ✅ removed: ${d}`)
  for (const d of failedDomains) console.log(`  ❌ failed:  ${d}`)
  console.log('- traefik: restarted')
}

const removeProjectFile = (route: RouteEntry, projectRoutes: RouteEntry[], composePath: string): void => {
  fs.unlinkSync(route.filePath)
  const remainingRoutes = readRoutes()
  const removedDomains: string[] = []
  for (const r of projectRoutes) {
    const stillUsed = remainingRoutes.some((rem) => rem.domain === r.domain)
    if (!stillUsed) {
      removeHostsEntry(r.domain)
      removedDomains.push(r.domain)
    }
  }
  restartTraefik(composePath)
  const projectName = path.basename(route.filePath, path.extname(route.filePath))
  console.log('\nSummary:')
  for (const d of removedDomains) console.log(`- removed domain: ${d}`)
  console.log(`- removed route file: ${route.fileName}`)
  console.log('- traefik: restarted')
  console.log(`\n✅ Removed project: ${projectName} (${String(removedDomains.length)} domain(s))`)
}

const unlinkCommand = async (target?: string, opts?: { domain?: string; all?: boolean }): Promise<void> => {
  const composePath = resolveTraefikComposePath()
  const routes = readRoutes()

  if (routes.length === 0) {
    console.log('No links found.')
    return
  }

  if (opts?.all === true && target === undefined && opts.domain === undefined) {
    await unlinkAll(composePath, routes)
    return
  }

  const autoSelect = opts?.all === true
  const route = await findRoute(routes, target, opts?.domain, autoSelect)
  const projectRoutes = routes.filter((r) => r.filePath === route.filePath)
  const isMultiDomain = projectRoutes.length > 1

  if (!fs.existsSync(route.filePath)) {
    printError(`Routing file not found: ${route.fileName}`)
    process.exit(1)
  }

  if (isMultiDomain && opts?.all === true) {
    removeProjectFile(route, projectRoutes, composePath)
    return
  }

  let removeEntireProject = false
  if (isMultiDomain) {
    const projectName = path.basename(route.filePath, path.extname(route.filePath))
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: `Project '${projectName}' has ${String(projectRoutes.length)} domains. What should be removed?`,
        choices: [
          { name: `Only ${route.domain}`, value: 'one' },
          { name: `All ${String(projectRoutes.length)} domains (entire project)`, value: 'all' },
        ],
      },
    ]) as FindRouteAnswer
    removeEntireProject = answer.selection === 'all'
  }

  if (removeEntireProject) {
    removeProjectFile(route, projectRoutes, composePath)
    return
  }

  const confirmation = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove link for ${route.domain}?`,
      default: false,
    },
  ]) as ConfirmAnswer

  if (!confirmation.confirm) {
    console.log('Cancelled.')
    return
  }

  const fileDeleted = removeSingleRoute(route)

  const remainingRoutes = readRoutes()
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
  if (fileDeleted) console.log(`- removed route file: ${route.fileName}`)
  else console.log(`- updated route file: ${route.fileName}`)
  console.log(`- hosts: ${hostsStatus}`)
  console.log('- traefik: restarted')

  console.log(`\n✅ Removed link: ${route.domain}`)
}

export default unlinkCommand
