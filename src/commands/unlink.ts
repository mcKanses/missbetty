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
interface CheckboxAnswer { selected: ChoiceValue[]; }

type ChoiceValue =
  | { kind: 'domain'; route: RouteEntry }
  | { kind: 'project'; filePath: string; group: RouteEntry[] }

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

const removeSingleWithSummary = (route: RouteEntry, composePath: string): void => {
  const fileDeleted = removeSingleRoute(route)
  const remainingRoutes = readRoutes()
  const domainStillUsed = remainingRoutes.some((r) => r.domain === route.domain && r.filePath !== route.filePath)
  let hostsStatus: string
  if (!domainStillUsed) {
    const hostsUpdated = removeHostsEntry(route.domain)
    if (!hostsUpdated) console.log(`Domain still needs manual cleanup in hosts: ${route.domain}`)
    hostsStatus = hostsUpdated ? 'removed/ok' : 'manual action required'
  } else {
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

const unlinkInteractive = async (composePath: string, routes: RouteEntry[]): Promise<void> => {
  if (routes.length === 1) {
    const route = routes[0]
    if (!fs.existsSync(route.filePath)) {
      printError(`Routing file not found: ${route.fileName}`)
      process.exit(1)
    }
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Remove link for ${route.domain}?`,
      default: false,
    }]) as ConfirmAnswer
    if (!confirm) { console.log('Cancelled.'); return }
    removeSingleWithSummary(route, composePath)
    return
  }

  const byFile = new Map<string, RouteEntry[]>()
  for (const r of routes) {
    const g = byFile.get(r.filePath) ?? []
    g.push(r)
    byFile.set(r.filePath, g)
  }

  const choices: { name: string; value: ChoiceValue }[] = []
  for (const [filePath, group] of byFile) {
    for (const r of group) choices.push({
        name: `${r.domain}${r.target !== '' ? ` → ${r.target}` : ''}`,
        value: { kind: 'domain', route: r },
      })
    
    if (group.length > 1) {
      const projectName = path.basename(filePath, path.extname(filePath))
      choices.push({
        name: `All domains in project "${projectName}"`,
        value: { kind: 'project', filePath, group },
      })
    }
  }

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: 'Select what to unlink (space to toggle, a = all/none):',
    choices,
  }]) as CheckboxAnswer

  if (selected.length === 0) {
    console.log('Nothing selected.')
    return
  }

  const removeProjects = new Map<string, RouteEntry[]>()
  for (const s of selected) if (s.kind === 'project') removeProjects.set(s.filePath, s.group)
  

  for (const [filePath, group] of byFile) {
    if (removeProjects.has(filePath) || group.length <= 1) continue
    const allPicked = group.every((r) =>
      selected.some((s): s is { kind: 'domain'; route: RouteEntry } =>
        s.kind === 'domain' && s.route.filePath === filePath && s.route.routerName === r.routerName
      )
    )
    if (allPicked) removeProjects.set(filePath, group)
  }

  const removeSingles = selected
    .filter((s): s is { kind: 'domain'; route: RouteEntry } =>
      s.kind === 'domain' && !removeProjects.has(s.route.filePath)
    )
    .map((s) => s.route)

  const removedDomains: string[] = []
  const failedItems: string[] = []

  for (const [filePath, group] of removeProjects) {
    if (!fs.existsSync(filePath)) {
      printError(`Routing file not found: ${group[0].fileName}`)
      failedItems.push(...group.map((r) => r.domain))
      continue
    }
    fs.unlinkSync(filePath)
    const remainingRoutes = readRoutes()
    for (const r of group) if (!remainingRoutes.some((rem) => rem.domain === r.domain)) {
        removeHostsEntry(r.domain)
        removedDomains.push(r.domain)
      }
    
  }

  for (const route of removeSingles) {
    if (!fs.existsSync(route.filePath)) {
      printError(`Routing file not found: ${route.fileName}`)
      failedItems.push(route.domain)
      continue
    }
    removeSingleRoute(route)
    const remainingRoutes = readRoutes()
    if (!remainingRoutes.some((r) => r.domain === route.domain && r.filePath !== route.filePath)) {
      const hostsUpdated = removeHostsEntry(route.domain)
      if (!hostsUpdated) console.log(`Domain still needs manual cleanup in hosts: ${route.domain}`)
      removedDomains.push(route.domain)
    } else console.log(`Keeping hosts entry because the domain is still in use: ${route.domain}`)
    
  }

  restartTraefik(composePath)

  console.log('\nSummary:')
  for (const d of removedDomains) console.log(`  ✅ removed: ${d}`)
  for (const d of failedItems) console.log(`  ❌ failed:  ${d}`)
  console.log('- traefik: restarted')
}

const unlinkCommand = async (target?: string, opts?: { domain?: string; all?: boolean; yes?: boolean }): Promise<void> => {
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

  if (target === undefined && opts?.domain === undefined) {
    await unlinkInteractive(composePath, routes)
    return
  }

  const autoSelect = opts?.all === true || opts?.yes === true
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

  if (isMultiDomain && opts?.yes !== true) {
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
    if (answer.selection === 'all') {
      removeProjectFile(route, projectRoutes, composePath)
      return
    }
  }

  if (opts?.yes !== true) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Remove link for ${route.domain}?`,
      default: false,
    }]) as ConfirmAnswer
    if (!confirm) { console.log('Cancelled.'); return }
  }

  removeSingleWithSummary(route, composePath)
}

export default unlinkCommand
