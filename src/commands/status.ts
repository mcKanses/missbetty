
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import yaml from 'yaml'
import type { DockerInspectEntry, TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'
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

const getContainerMetaByIp = (ip: string): { uptime: string; health: string; restarts: string } => {
  try {
    const idsOutput = execSync('docker ps --format {{.ID}}', { stdio: 'pipe' }).toString().trim()
    if (!idsOutput) return { uptime: 'n/a', health: 'n/a', restarts: 'n/a' }

    const ids = idsOutput.split('\n').filter(Boolean)
    for (const id of ids) try {
        const inspectOut = execSync(`docker inspect ${id}`, { stdio: 'pipe' }).toString()
        const inspectJson = JSON.parse(inspectOut) as DockerInspectEntry[]
        const container = inspectJson.length > 0 ? inspectJson[0] : null
        if (!container) continue
        const networks = container.NetworkSettings.Networks
        const networkMatch = Object.values(networks).find((n) => n.IPAddress === ip)
        if (!networkMatch) continue

        const startedAt = container.State.StartedAt
        const uptime = startedAt !== '0001-01-01T00:00:00Z'
          ? `${String(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)))}m`
          : 'n/a'
        const health = container.State.Health?.Status ?? container.State.Status
        const restarts = String(container.RestartCount)
        return { uptime, health, restarts }
      } catch {
        // next container
      }
    
  } catch {
    // ignore
  }

  return { uptime: 'n/a', health: 'n/a', restarts: 'n/a' }
}

const readProjectsFromDynamicFiles = (composePath: string): ProjectStatus[] => {
  const dynamicDir = path.resolve(path.dirname(composePath), 'dynamic')
  if (!fs.existsSync(dynamicDir)) return []

  const files = fs.readdirSync(dynamicDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  const projects: ProjectStatus[] = []

  for (const file of files) try {
      const doc = yaml.parse(fs.readFileSync(path.join(dynamicDir, file), 'utf8')) as TraefikDynamicConfig
      const routers: Record<string, TraefikRouter> = doc.http?.routers ?? {}
      const services: Record<string, TraefikService> = doc.http?.services ?? {}

      const nonSecureKeys = Object.keys(routers).filter((key) => !key.endsWith('-secure'))
      const routerKeys = nonSecureKeys.length > 0 ? nonSecureKeys
        : Object.keys(routers).length > 0 ? [Object.keys(routers)[0]]
        : [path.basename(file, path.extname(file))]

      for (const routerKey of routerKeys) {
        const rule = (routers[routerKey] as TraefikRouter | undefined)?.rule ?? ''
        const domainMatch = /Host\("([^"]+)"\)/.exec(rule)
        const domain = domainMatch?.[1] ?? 'n/a'
        const serviceKey = routerKey in services ? routerKey : (Object.keys(services)[0] ?? routerKey)
        const url = (services[serviceKey] as TraefikService | undefined)?.loadBalancer?.servers?.[0]?.url ?? ''
        const portMatch = url !== '' ? /:(\d+)(?:\/)?$/.exec(url) : null
        const port = portMatch?.[1] ?? 'n/a'

        let domainWithProtocol = domain
        if (domain !== 'n/a') if (url.startsWith('https://')) domainWithProtocol = `https://${domain}`
          else if (url.startsWith('http://')) domainWithProtocol = `http://${domain}`
          else if (port === '443') domainWithProtocol = `https://${domain}`
          else domainWithProtocol = `http://${domain}`

        const target = url !== '' ? url : 'n/a'
        const ipMatch = /^https?:\/\/([^:/]+)(?::\d+)?/i.exec(url)
        const ip = ipMatch?.[1] ?? ''
        const meta = ip !== '' ? getContainerMetaByIp(ip) : { uptime: 'n/a', health: 'n/a', restarts: 'n/a' }

        projects.push({
          name: routerKey,
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

if (require.main === module) statusCommand()


export default statusCommand
