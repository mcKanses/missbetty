
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import yaml from 'yaml'
import type { DockerInspectEntry, TraefikDynamicConfig } from '../types'
import { databaseUrl, domainUrl } from '../utils/config'
import { parseRoutes } from '../utils/routes'
import { BETTY_PROXY_COMPOSE, BETTY_TRAEFIK_CONTAINER } from '../utils/constants'

interface ProjectStatus {
  name: string;
  domain: string;
  port: string;
  target: string;
  uptime: string;
  health: string;
  restarts: string;
}

interface StatusOptions {
  long?: boolean;
  json?: boolean;
  format?: string;
  short?: boolean;
}

const resolveTraefikComposePath = (): string | null =>
  fs.existsSync(BETTY_PROXY_COMPOSE) ? BETTY_PROXY_COMPOSE : null

const getTraefikContainerStatus = (_composePath: string): { proxyRunning: boolean; proxyInfo: string; proxyUptime: string; traefikContainer: DockerInspectEntry | null } => {
  let proxyRunning = false
  let proxyInfo = 'Proxy is not running.'
  let proxyUptime = ''
  let traefikContainer: DockerInspectEntry | null = null

  try {
    const output = execSync(`docker inspect ${BETTY_TRAEFIK_CONTAINER}`, { stdio: 'pipe' })
    const containers = JSON.parse(output.toString()) as DockerInspectEntry[]
    traefikContainer = containers.length > 0 ? containers[0] : null
    proxyRunning = traefikContainer?.State.Running === true
    const startedAt = traefikContainer?.State.StartedAt
    proxyUptime = startedAt !== undefined && startedAt !== '0001-01-01T00:00:00Z'
      ? `${String(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)))}m`
      : ''
    proxyInfo = proxyRunning ? 'Proxy is running.' : 'Proxy is not running.'
  } catch {
    // proxyInfo defaults to 'Proxy is not running.'
  }

  return { proxyRunning, proxyInfo, proxyUptime, traefikContainer }
}

interface ContainerMeta {
  uptime: string;
  health: string;
  restarts: string;
}

const NO_META: ContainerMeta = { uptime: 'n/a', health: 'n/a', restarts: 'n/a' }

// Inspects every running container in a single call. Status then costs two docker
// calls in total instead of one inspect per container for every route.
const inspectRunningContainers = (): DockerInspectEntry[] => {
  try {
    const ids = execSync('docker ps --format {{.ID}}', { stdio: 'pipe' }).toString().split(/\r?\n/).map((id) => id.trim()).filter(Boolean)
    if (ids.length === 0) return []
    return JSON.parse(execSync(`docker inspect ${ids.join(' ')}`, { stdio: 'pipe' }).toString()) as DockerInspectEntry[]
  } catch {
    return []
  }
}

// Route targets name the container (current format) or hold the IP captured at
// link time (older route files), so match either.
const metaForTarget = (containers: DockerInspectEntry[], host: string): ContainerMeta => {
  const container = containers.find((c) =>
    c.Name?.replace(/^\//, '') === host ||
    Object.values(c.NetworkSettings.Networks).some((n) => n.IPAddress === host)
  )
  if (container === undefined) return NO_META

  const startedAt = container.State.StartedAt
  const uptime = startedAt !== '0001-01-01T00:00:00Z'
    ? `${String(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)))}m`
    : 'n/a'
  const health = container.State.Health?.Status ?? container.State.Status
  const restarts = String(container.RestartCount)
  return { uptime, health, restarts }
}

const readProjectsFromDynamicFiles = (composePath: string): ProjectStatus[] => {
  const dynamicDir = path.resolve(path.dirname(composePath), 'dynamic')
  if (!fs.existsSync(dynamicDir)) return []

  const files = fs.readdirSync(dynamicDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  const projects: ProjectStatus[] = []
  // Inspected on first use, once for all routes.
  let containers: DockerInspectEntry[] | null = null

  for (const file of files) try {
      const doc = yaml.parse(fs.readFileSync(path.join(dynamicDir, file), 'utf8')) as TraefikDynamicConfig | null
      const projectName = path.basename(file, path.extname(file))

      for (const route of parseRoutes(doc, projectName)) {
        const url = route.target
        const port = route.port !== '' ? route.port : 'n/a'
        const domainWithProtocol = route.domain === '' ? 'n/a'
          : route.tcp ? databaseUrl(route.domain)
          : domainUrl(route.domain, route.https)

        const target = url !== '' ? url : 'n/a'
        const host = /^https?:\/\/([^:/]+)(?::\d+)?/i.exec(url)?.[1] ?? ''
        if (host !== '' && containers === null) containers = inspectRunningContainers()
        const meta = host !== '' ? metaForTarget(containers ?? [], host) : NO_META

        projects.push({
          name: projectName,
          domain: domainWithProtocol,
          port,
          target,
          uptime: meta.uptime,
          health: meta.health,
          restarts: meta.restarts,
        } satisfies ProjectStatus)
      }
    } catch {
      // ignore
    }

  return projects
}

const statusCommand = (opts?: StatusOptions): void => {
  const composePath = resolveTraefikComposePath()
  const proxy = composePath !== null
    ? getTraefikContainerStatus(composePath)
    : {
        proxyRunning: false,
        proxyInfo: 'Could not determine proxy status.',
        proxyUptime: '',
        traefikContainer: null,
      }

  const projects = composePath !== null ? readProjectsFromDynamicFiles(composePath) : []

  if (opts !== undefined && (opts.json === true || opts.format === 'json')) {
    const output = {
      proxy: {
        running: proxy.proxyRunning,
        info: proxy.proxyInfo,
        uptime: proxy.proxyUptime,
        container: proxy.traefikContainer ?? null,
      },
      projects,
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  if (projects.length > 0) {
    const nameW = Math.max(12, ...projects.map((p) => p.name.length))
    const domainW = Math.max(12, ...projects.map((p) => p.domain.length))
    const portW = Math.max(4, ...projects.map((p) => p.port.length))
    if (opts?.short === true) {
      const targetW = Math.max(12, ...projects.map((p) => p.target.length))
      const header = `${'project name'.padEnd(nameW)} | ${'domain'.padEnd(domainW)} | ${'port'.padEnd(portW)} | ${'target'.padEnd(targetW)}`
      const sep = `${'-'.repeat(nameW)}-|-${'-'.repeat(domainW)}-|-${'-'.repeat(portW)}-|-${'-'.repeat(targetW)}`
      console.log(`\n${header}`)
      console.log(sep)
      projects.forEach((p) => {
        console.log(`${p.name.padEnd(nameW)} | ${p.domain.padEnd(domainW)} | ${p.port.padEnd(portW)} | ${p.target.padEnd(targetW)}`)
      })
    } else {
      const uptimeW = Math.max(6, ...projects.map((p) => p.uptime.length))
      const healthW = Math.max(6, ...projects.map((p) => p.health.length))
      const restartsW = Math.max(8, ...projects.map((p) => p.restarts.length))
      const targetW = Math.max(12, ...projects.map((p) => p.target.length))
      const header = `${'project name'.padEnd(nameW)} | ${'domain'.padEnd(domainW)} | ${'port'.padEnd(portW)} | ${'target'.padEnd(targetW)} | ${'uptime'.padEnd(uptimeW)} | ${'health'.padEnd(healthW)} | ${'restarts'.padEnd(restartsW)}`
      const sep = `${'-'.repeat(nameW)}-|-${'-'.repeat(domainW)}-|-${'-'.repeat(portW)}-|-${'-'.repeat(targetW)}-|-${'-'.repeat(uptimeW)}-|-${'-'.repeat(healthW)}-|-${'-'.repeat(restartsW)}`
      console.log(`\n${header}`)
      console.log(sep)
      projects.forEach((p) => {
        console.log(`${p.name.padEnd(nameW)} | ${p.domain.padEnd(domainW)} | ${p.port.padEnd(portW)} | ${p.target.padEnd(targetW)} | ${p.uptime.padEnd(uptimeW)} | ${p.health.padEnd(healthW)} | ${p.restarts.padEnd(restartsW)}`)
      })
    }
  } else {
    console.log(proxy.proxyInfo)
    console.log('No links found. Link a container first with "betty link".')
  }

  if (opts?.long === true && proxy.traefikContainer !== null) {
    console.log('\n--- Traefik Container Details ---')
    Object.entries(proxy.traefikContainer).forEach(([k, v]) => {
      console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    })
  }
}

export default statusCommand
