import path from 'path'
import fs from 'fs'
import yaml from 'yaml'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'
import { BETTY_DYNAMIC_DIR } from './constants'
import { normalizeServiceName } from './names'

// Betty stores the source container name in a leading YAML comment so relink can
// recover it. Traefik's file provider ignores comments, so this stays invisible
// to the proxy.
const CONTAINER_COMMENT = /^#\s*betty-container:\s*(.+?)\s*$/m

export interface RouteEntry {
  filePath: string;
  fileName: string;
  routerName: string;
  container: string;
  domain: string;
  target: string;
  port: string;
}

export const readRoutes = (): RouteEntry[] => {
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) return []

  const entries: RouteEntry[] = []

  for (const file of fs.readdirSync(BETTY_DYNAMIC_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
    const filePath = path.join(BETTY_DYNAMIC_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const doc = yaml.parse(content) as TraefikDynamicConfig
      const storedContainer = CONTAINER_COMMENT.exec(content)?.[1]
      const routers: Record<string, TraefikRouter> = doc.http?.routers ?? {}
      const services: Record<string, TraefikService> = doc.http?.services ?? {}

      const nonSecureKeys = Object.keys(routers).filter((key) => !key.endsWith('-secure'))
      const routerKeys = nonSecureKeys.length > 0 ? nonSecureKeys
        : Object.keys(routers).length > 0 ? [Object.keys(routers)[0]]
        : [path.basename(file, path.extname(file))]

      for (const routerKey of routerKeys) {
        const rule = (routers[routerKey] as TraefikRouter | undefined)?.rule ?? ''
        const domain = /Host\("([^"]+)"\)/.exec(rule)?.[1] ?? ''
        const serviceKey = routerKey in services ? routerKey : (Object.keys(services)[0] ?? routerKey)
        const target = (services[serviceKey] as TraefikService | undefined)?.loadBalancer?.servers?.[0]?.url ?? ''
        const port = /:(\d+)(?:\/)?$/.exec(target)?.[1] ?? ''
        entries.push({ filePath, fileName: file, routerName: routerKey, container: storedContainer ?? routerKey, domain, target, port })
      }
    } catch {
      // Ignore malformed route files.
    }
  }

  return entries
}

export const findDomainConflict = (domain: string, ignoreFilePath?: string): { fileName: string; routerName: string } | null => {
  // Compare on the normalized service name, not the raw domain, so two distinct
  // domains that collapse to the same route file name (e.g. "a.b.localhost" and
  // "a-b.localhost", or case variants on case-insensitive file systems) are
  // reported as a conflict instead of silently overwriting each other.
  const target = normalizeServiceName(domain.toLowerCase())
  const routes = readRoutes()
  for (const route of routes) {
    if (ignoreFilePath !== undefined && route.filePath === ignoreFilePath) continue
    if (normalizeServiceName(route.domain.toLowerCase()) !== target) continue
    return { fileName: route.fileName, routerName: route.routerName }
  }
  return null
}

export const writeRouteConfig = (
  container: string,
  domain: string,
  ip: string,
  port: number,
  certificate: { certFile: string; keyFile: string } | null,
  oldFilePath?: string
): void => {
  // Route identity is derived from the domain, not the container, so linking one
  // container to multiple domains writes distinct files with globally unique
  // Traefik router/service keys instead of overwriting each other.
  const name = normalizeServiceName(domain)
  const routers: Record<string, TraefikRouter> = {
    [name]: {
      rule: `Host("${domain}")`,
      entryPoints: ['web'],
      service: name,
    },
  }

  if (certificate !== null) routers[`${name}-secure`] = {
    rule: `Host("${domain}")`,
    entryPoints: ['websecure'],
    service: name,
    tls: {},
  }

  const config: TraefikDynamicConfig = {
    http: {
      routers,
      services: {
        [name]: {
          loadBalancer: {
            servers: [{ url: `http://${ip}:${String(port)}` }],
          },
        },
      },
    },
  }

  if (certificate !== null) config.tls = {
    certificates: [{ certFile: certificate.certFile, keyFile: certificate.keyFile }],
  }

  const nextPath = path.join(BETTY_DYNAMIC_DIR, `${name}.yml`)
  if (oldFilePath !== undefined && oldFilePath !== nextPath && fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath)
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) fs.mkdirSync(BETTY_DYNAMIC_DIR, { recursive: true })
  fs.writeFileSync(nextPath, `# betty-container: ${container}\n${yaml.stringify(config)}`, 'utf8')
  console.log(`${oldFilePath !== undefined ? 'Updated' : 'Wrote'} routing configuration: ${name}.yml`)
}
