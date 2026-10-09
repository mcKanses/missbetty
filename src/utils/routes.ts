import path from 'path'
import fs from 'fs'
import yaml from 'yaml'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService, TraefikTcpService } from '../types'
import { BETTY_DYNAMIC_DIR } from './constants'
import { certificateBaseName, normalizeServiceName, sanitizeName } from './names'
import { getLinkContainer, setLinkContainer, removeLinkContainer } from './state'

// Betty stores the source container name in a leading YAML comment so relink can
// recover it. Traefik's file provider ignores comments, so this stays invisible
// to the proxy.
const CONTAINER_COMMENT = /^#\s*betty-container:\s*(.+?)\s*$/m

export interface RouteEntry {
  filePath: string;
  fileName: string;
  routerName: string;
  container: string;
  // False when no container is recorded and container is just the router name,
  // as for project routes, which point at host services rather than containers.
  containerKnown?: boolean;
  domain: string;
  target: string;
  port: string;
  // A database (TCP) route from a .betty.yml postgres:// target.
  tcp?: boolean;
}

export interface ParsedRoute {
  routerName: string;
  domain: string;
  target: string;
  port: string;
  https: boolean;
  // A TCP route (database domain) rather than an HTTP route.
  tcp: boolean;
}

// The routes of one dynamic file: one per HTTP router (its -secure twin folded
// in) and one per TCP router. A file without routers yields one empty route
// named after the file, so callers can still list and remove it.
export const parseRoutes = (doc: TraefikDynamicConfig | null, fallbackName: string): ParsedRoute[] => {
  const routers: Record<string, TraefikRouter> = doc?.http?.routers ?? {}
  const services: Record<string, TraefikService> = doc?.http?.services ?? {}
  const tcpRouters: Record<string, TraefikRouter> = doc?.tcp?.routers ?? {}
  const tcpServices: Record<string, TraefikTcpService> = doc?.tcp?.services ?? {}

  const nonSecureKeys = Object.keys(routers).filter((key) => !key.endsWith('-secure'))
  const routerKeys = nonSecureKeys.length > 0 ? nonSecureKeys
    : Object.keys(routers).length > 0 ? [Object.keys(routers)[0]]
    : Object.keys(tcpRouters).length > 0 ? []
    : [fallbackName]

  const httpRoutes = routerKeys.map((routerKey): ParsedRoute => {
    const rule = (routers[routerKey] as TraefikRouter | undefined)?.rule ?? ''
    const domain = /Host\("([^"]+)"\)/.exec(rule)?.[1] ?? ''
    const serviceKey = routerKey in services ? routerKey : (Object.keys(services)[0] ?? routerKey)
    const target = (services[serviceKey] as TraefikService | undefined)?.loadBalancer?.servers?.[0]?.url ?? ''
    const port = /:(\d+)(?:\/)?$/.exec(target)?.[1] ?? ''
    const https = `${routerKey}-secure` in routers || routerKey.endsWith('-secure') || target.startsWith('https://') || port === '443'
    return { routerName: routerKey, domain, target, port, https, tcp: false }
  })

  const tcpRoutes = Object.entries(tcpRouters).map(([routerKey, router]): ParsedRoute => {
    const domain = /HostSNI\(`([^`]+)`\)/.exec(router.rule ?? '')?.[1] ?? ''
    const address = (tcpServices[router.service ?? routerKey] as TraefikTcpService | undefined)?.loadBalancer?.servers?.[0]?.address ?? ''
    const port = /:(\d+)$/.exec(address)?.[1] ?? ''
    return { routerName: routerKey, domain, target: address !== '' ? `tcp://${address}` : '', port, https: true, tcp: true }
  })

  return [...httpRoutes, ...tcpRoutes]
}

export const readRoutes = (): RouteEntry[] => {
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) return []

  const entries: RouteEntry[] = []

  for (const file of fs.readdirSync(BETTY_DYNAMIC_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
    const filePath = path.join(BETTY_DYNAMIC_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const doc = yaml.parse(content) as TraefikDynamicConfig | null
      const storedContainer = CONTAINER_COMMENT.exec(content)?.[1]
      const knownContainer = getLinkContainer(file) ?? storedContainer

      for (const route of parseRoutes(doc, path.basename(file, path.extname(file)))) entries.push({
        filePath,
        fileName: file,
        routerName: route.routerName,
        container: knownContainer ?? route.routerName,
        containerKnown: knownContainer !== undefined,
        domain: route.domain,
        target: route.target,
        port: route.port,
        tcp: route.tcp,
      })
    } catch {
      // Ignore malformed route files.
    }
  }

  return entries
}

// What a conflict check may skip: a whole file (a project re-linking itself), or
// one route in it (relink). A project file holds several routes, so skipping the
// whole file on relink would miss a clash with the project's other domains.
export interface ConflictIgnore {
  filePath: string;
  routerName?: string;
}

export const findDomainConflict = (domain: string, ignore?: ConflictIgnore): { fileName: string; routerName: string } | null => {
  // Compare on the normalized service name, not the raw domain, so two distinct
  // domains that collapse to the same route file name (e.g. "a.b.localhost" and
  // "a-b.localhost", or case variants on case-insensitive file systems) are
  // reported as a conflict instead of silently overwriting each other.
  const target = normalizeServiceName(domain.toLowerCase())
  const routes = readRoutes()
  for (const route of routes) {
    const ignored = ignore?.filePath === route.filePath
      && (ignore.routerName === undefined || route.routerName === ignore.routerName)
    if (ignored) continue
    if (normalizeServiceName(route.domain.toLowerCase()) !== target) continue
    return { fileName: route.fileName, routerName: route.routerName }
  }
  return null
}

// A link writes its route to <normalized-domain>.yml, which can be the file of a
// project with that name (project `api-dev` vs. domain `api.dev`). Returns a
// route of such a foreign file, so the caller refuses instead of overwriting the
// project's other domains. `ignoreFilePath` skips the link's own current file.
// Compared case-insensitively for case-insensitive file systems.
export const routeFileOccupant = (domain: string, ignoreFilePath?: string): RouteEntry | undefined => {
  const ownName = normalizeServiceName(domain).toLowerCase()
  return readRoutes().find((route) =>
    route.filePath !== ignoreFilePath &&
    route.fileName.toLowerCase() === `${ownName}.yml` &&
    route.routerName.toLowerCase() !== ownName
  )
}

// The TLS options of a TCP route. Named per router, so removing one route takes
// its options along and two files never define the same options.
export const tlsOptionsName = (routerName: string): string => `${routerName}-tls`

// Removes one route (router, its -secure twin, service and certificate) from its
// file, and deletes the file once no router is left. Returns true when deleted.
// Project files hold several domains, so the other routes must survive.
export const removeRouteFromFile = (route: RouteEntry): boolean => {
  const content = fs.readFileSync(route.filePath, 'utf8')
  const doc = yaml.parse(content) as TraefikDynamicConfig
  // yaml.stringify drops comments; keep the leading ones Betty stores metadata in
  // (the project origin, the source container).
  const header = /^(?:#[^\n]*\n)*/.exec(content)?.[0] ?? ''

  if (doc.http?.routers !== undefined) {
    const secureKey = `${route.routerName}-secure`
    doc.http.routers = Object.fromEntries(
      Object.entries(doc.http.routers).filter(([k]) => k !== route.routerName && k !== secureKey)
    )
  }
  if (doc.http?.services !== undefined) doc.http.services = Object.fromEntries(
    Object.entries(doc.http.services).filter(([k]) => k !== route.routerName)
  )
  if (doc.tcp?.routers !== undefined) doc.tcp.routers = Object.fromEntries(
    Object.entries(doc.tcp.routers).filter(([k]) => k !== route.routerName)
  )
  if (doc.tcp?.services !== undefined) doc.tcp.services = Object.fromEntries(
    Object.entries(doc.tcp.services).filter(([k]) => k !== route.routerName)
  )
  if (doc.tls?.options !== undefined) {
    const optionsName = tlsOptionsName(route.routerName)
    doc.tls.options = Object.fromEntries(Object.entries(doc.tls.options).filter(([k]) => k !== optionsName))
    if (Object.keys(doc.tls.options).length === 0) delete doc.tls.options
  }

  if (doc.tls?.certificates !== undefined) {
    const certFileName = `${certificateBaseName(route.domain)}.pem`
    doc.tls.certificates = doc.tls.certificates.filter((c) => path.basename(c.certFile) !== certFileName)
    if (doc.tls.certificates.length === 0) delete doc.tls.certificates
  }
  if (doc.tls !== undefined && Object.keys(doc.tls).length === 0) delete doc.tls
  if (doc.tcp?.routers !== undefined && Object.keys(doc.tcp.routers).length === 0) delete doc.tcp

  const hasRouters = (doc.http?.routers !== undefined && Object.keys(doc.http.routers).length > 0)
    || (doc.tcp?.routers !== undefined && Object.keys(doc.tcp.routers).length > 0)
  if (!hasRouters) {
    fs.unlinkSync(route.filePath)
    removeLinkContainer(route.fileName)
    return true
  }

  fs.writeFileSync(route.filePath, `${header}${yaml.stringify(doc)}`, 'utf8')
  return false
}

// A project route file records which .betty.yml wrote it. Route files are named
// after the project, and the default name is the directory name, so two projects
// can collide; the origin tells them apart.
const PROJECT_ORIGIN_COMMENT = /^#\s*betty-project-config:\s*(.+?)\s*$/m

export const projectRouteFile = (project: string): string => path.join(BETTY_DYNAMIC_DIR, `${sanitizeName(project)}.yml`)

export const readProjectOrigin = (routeFile: string): string | null => {
  try {
    return PROJECT_ORIGIN_COMMENT.exec(fs.readFileSync(routeFile, 'utf8'))?.[1] ?? null
  } catch {
    return null
  }
}

// The other .betty.yml a project's route file was loaded from, or null when it
// is this one, unknown, or not loaded at all.
export const loadedFromElsewhere = (project: string, configPath: string): string | null => {
  const origin = readProjectOrigin(projectRouteFile(project))
  return origin !== null && path.resolve(origin) !== path.resolve(configPath) ? origin : null
}

export const writeRouteConfig = (
  container: string,
  domain: string,
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

  // Target the container by name, not by an IP captured at link time. Traefik and
  // the container share the betty_proxy network, so Docker's embedded DNS resolves
  // the name to the current IP on every dial. A restart that reassigns the IP keeps
  // working without a relink. A recreated container is a new instance that is not
  // attached to betty_proxy, so it still needs `betty relink`.
  const config: TraefikDynamicConfig = {
    http: {
      routers,
      services: {
        [name]: {
          loadBalancer: {
            servers: [{ url: `http://${container}:${String(port)}` }],
          },
        },
      },
    },
  }

  if (certificate !== null) config.tls = {
    certificates: [{ certFile: certificate.certFile, keyFile: certificate.keyFile }],
  }

  const nextPath = path.join(BETTY_DYNAMIC_DIR, `${name}.yml`)
  if (oldFilePath !== undefined && oldFilePath !== nextPath && fs.existsSync(oldFilePath)) {
    fs.unlinkSync(oldFilePath)
    removeLinkContainer(path.basename(oldFilePath))
  }
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) fs.mkdirSync(BETTY_DYNAMIC_DIR, { recursive: true })
  fs.writeFileSync(nextPath, `# betty-container: ${container}\n${yaml.stringify(config)}`, 'utf8')
  setLinkContainer(`${name}.yml`, container)
  console.log(`${oldFilePath !== undefined ? 'Updated' : 'Wrote'} routing configuration: ${name}.yml`)
}
