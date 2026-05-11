import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { printError } from '../cli/ui/output'
import { checkMkcertInstalled, isHttpsRequestedDomain } from './setup'
import type { DockerInspectEntry, DockerNetworkEntry } from '../types'
import {
  BETTY_PROXY_COMPOSE,
  BETTY_CERTS_DIR,
  BETTY_PROXY_NETWORK,
} from './constants'
import { sanitizeName } from './names'

export const resolveTraefikComposePath = (): string => {
  if (fs.existsSync(BETTY_PROXY_COMPOSE)) return BETTY_PROXY_COMPOSE
  printError("Betty's proxy is not set up yet. Run: betty serve")
  process.exit(1)
}

export const getRunningContainers = (): string[] => {
  try {
    return execSync('docker ps --format {{.Names}}', { stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

export const connectContainerToNetwork = (containerName: string): void => {
  try {
    const info = JSON.parse(
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
    ) as DockerInspectEntry[]
    const networkKeys = Object.keys(info[0].NetworkSettings.Networks)
    if (networkKeys.includes(BETTY_PROXY_NETWORK)) return
  } catch {
    printError(`Container '${containerName}' not found. Make sure it is running: docker ps`)
    process.exit(1)
  }

  try {
    execSync(`docker network connect ${BETTY_PROXY_NETWORK} ${containerName}`, { stdio: 'inherit' })
    console.log(`Connected container '${containerName}' to network '${BETTY_PROXY_NETWORK}'.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printError(`Failed to connect '${containerName}' to Betty's network.`)
    printError(message)
    process.exit(1)
  }
}

export const getContainerIp = (containerName: string): string => {
  let info: DockerInspectEntry[]
  try {
    info = JSON.parse(
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
    ) as DockerInspectEntry[]
  } catch {
    printError(`Container '${containerName}' not found. Make sure it is running: docker ps`)
    process.exit(1)
  }
  const networks = info[0].NetworkSettings.Networks as Record<string, DockerNetworkEntry | undefined>
  const ip = networks[BETTY_PROXY_NETWORK]?.IPAddress ?? ''
  if (ip === '') {
    printError(`Could not determine IP for '${containerName}' in network '${BETTY_PROXY_NETWORK}'.`)
    printError(`Try disconnecting and re-linking: betty unlink && betty link`)
    process.exit(1)
  }
  return ip
}

// Restart Traefik so it picks up the config.
// Windows bind mounts do not trigger inotify events in the container.
export const restartTraefik = (composePath: string): void => {
  try {
    execSync(`docker compose -f "${composePath}" restart traefik`, {
      cwd: path.dirname(composePath),
      stdio: 'inherit',
    })
    console.log('Restarted Traefik.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printError(`Failed to restart Traefik. Try: betty serve`)
    printError(message)
    process.exit(1)
  }
}

export const ensureCertificate = (domain: string): { certFile: string; keyFile: string } | null => {
  if (!fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })

  const baseName = sanitizeName(domain)
  const certPath = path.join(BETTY_CERTS_DIR, `${baseName}.pem`)
  const keyPath = path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`)

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return {
    certFile: `/certs/${baseName}.pem`,
    keyFile: `/certs/${baseName}-key.pem`,
  }

  const httpsRequested = isHttpsRequestedDomain(domain)
  if (!checkMkcertInstalled()) {
    if (httpsRequested) {
      printError('HTTPS requested but mkcert is not installed. Run `betty setup`.')
      process.exit(1)
    }

    console.log(`\n⚠️  mkcert is not installed. Falling back to HTTP for ${domain}.`)
    return null
  }

  try {
    execSync('mkcert -install', { stdio: 'inherit' })
    execSync(`mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${domain}"`, { stdio: 'inherit' })
    return {
      certFile: `/certs/${baseName}.pem`,
      keyFile: `/certs/${baseName}-key.pem`,
    }
  } catch {
    if (httpsRequested) {
      printError(`HTTPS requested for ${domain} but certificate creation failed. Run \`betty setup\`.`)
      process.exit(1)
    }

    console.log(`\n⚠️  Could not create a local certificate for ${domain}.`)
    console.log('   Falling back to HTTP on port 80 for this domain.')
    return null
  }
}
