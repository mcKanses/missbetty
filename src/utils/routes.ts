import path from 'path'
import fs from 'fs'
import yaml from 'yaml'
import type { TraefikDynamicConfig, TraefikRouter, TraefikService } from '../types'
import { BETTY_DYNAMIC_DIR } from './constants'

export interface RouteEntry {
  filePath: string;
  fileName: string;
  routerName: string;
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
      const doc = yaml.parse(fs.readFileSync(filePath, 'utf8')) as TraefikDynamicConfig
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
        entries.push({ filePath, fileName: file, routerName: routerKey, domain, target, port })
      }
    } catch {
      // Ignore malformed route files.
    }
  }

  return entries
}

export const findDomainConflict = (domain: string, ignoreFilePath?: string): { fileName: string; routerName: string } | null => {
  const routes = readRoutes()
  for (const route of routes) {
    if (ignoreFilePath !== undefined && route.filePath === ignoreFilePath) continue
    if (route.domain.toLowerCase() !== domain.toLowerCase()) continue
    return { fileName: route.fileName, routerName: route.routerName }
  }
  return null
}

export const writeRouteConfig = (
  name: string,
  domain: string,
  ip: string,
  port: number,
  certificate: { certFile: string; keyFile: string } | null,
  oldFilePath?: string
): void => {
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
  fs.writeFileSync(nextPath, yaml.stringify(config), 'utf8')
  console.log(`${oldFilePath !== undefined ? 'Updated' : 'Wrote'} routing configuration: ${name}.yml`)
}
