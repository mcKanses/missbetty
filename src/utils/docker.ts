import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getHttpPort } from './config'
import { BettyError } from './errors'
import { checkMkcertInstalled, isHttpsRequestedDomain } from './setup'
import type { DockerInspectEntry } from '../types'
import {
  BETTY_PROXY_COMPOSE,
  BETTY_CERTS_DIR,
  BETTY_PROXY_NETWORK,
} from './constants'
import { sanitizeName } from './names'

export const resolveTraefikComposePath = (): string => {
  if (fs.existsSync(BETTY_PROXY_COMPOSE)) return BETTY_PROXY_COMPOSE
  throw new BettyError("Betty's proxy is not set up yet. Run: betty serve")
}

export const getRunningContainers = (): string[] => {
  try {
    return execFileSync('docker', ['ps', '--format', '{{.Names}}'], { stdio: 'pipe' })
      .toString()
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// Connects a running container to Betty's network and returns its canonical name.
// Routes must use that name: Docker's DNS resolves container names, not the ID or
// ID prefix a user may have passed to `betty link`.
export const connectContainerToNetwork = (containerRef: string): string => {
  let entry: DockerInspectEntry | undefined
  try {
    entry = (JSON.parse(
      execFileSync('docker', ['inspect', '--type', 'container', containerRef], { stdio: 'pipe' }).toString()
    ) as DockerInspectEntry[])[0]
  } catch {
    entry = undefined
  }
  if (entry === undefined) throw new BettyError(`Container '${containerRef}' not found. Make sure it is running: docker ps`)

  // A stopped container can be attached to the network, but Traefik cannot reach it.
  const state = entry.State as DockerInspectEntry['State'] | undefined
  if (state?.Running === false) throw new BettyError(`Container '${containerRef}' is not running.`, { hints: [`Start it first, then run the command again: docker start ${containerRef}`] })

  const inspectedName = entry.Name?.replace(/^\//, '') ?? ''
  const containerName = inspectedName !== '' ? inspectedName : containerRef
  if (Object.keys(entry.NetworkSettings.Networks).includes(BETTY_PROXY_NETWORK)) return containerName

  try {
    execFileSync('docker', ['network', 'connect', BETTY_PROXY_NETWORK, containerName], { stdio: 'inherit' })
    console.log(`Connected container '${containerName}' to network '${BETTY_PROXY_NETWORK}'.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new BettyError(`Failed to connect '${containerName}' to Betty's network.\n${message}`)
  }
  return containerName
}

// Restart Traefik so it picks up the config.
// Windows bind mounts do not trigger inotify events in the container.
export const restartTraefik = (composePath: string): void => {
  try {
    execFileSync('docker', ['compose', '-f', composePath, 'restart', 'traefik'], {
      cwd: path.dirname(composePath),
      stdio: 'inherit',
    })
    console.log('Restarted Traefik.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new BettyError(`Failed to restart Traefik. Try: betty serve\n${message}`)
  }
}

// Returns the certificate for a domain, creating it with mkcert when missing.
// Without a certificate it falls back to HTTP unless HTTPS is required: always
// for .dev (browsers force HTTPS there), or when the caller asks for it, as a
// project with `https.enabled` does.
export const ensureCertificate = (domain: string, opts: { required?: boolean } = {}): { certFile: string; keyFile: string } | null => {
  if (!fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })

  const baseName = sanitizeName(domain)
  const certPath = path.join(BETTY_CERTS_DIR, `${baseName}.pem`)
  const keyPath = path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`)

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return {
    certFile: `/certs/${baseName}.pem`,
    keyFile: `/certs/${baseName}-key.pem`,
  }

  const httpsRequested = opts.required === true || isHttpsRequestedDomain(domain)
  if (!checkMkcertInstalled()) {
    if (httpsRequested) throw new BettyError('HTTPS requested but mkcert is not installed. Run `betty setup`.')

    console.log(`\n⚠️  mkcert is not installed. Falling back to HTTP for ${domain}.`)
    return null
  }

  try {
    execFileSync('mkcert', ['-install'], { stdio: 'inherit' })
    execFileSync('mkcert', ['-cert-file', certPath, '-key-file', keyPath, domain], { stdio: 'inherit' })
    return {
      certFile: `/certs/${baseName}.pem`,
      keyFile: `/certs/${baseName}-key.pem`,
    }
  } catch {
    if (httpsRequested) throw new BettyError(`HTTPS requested for ${domain} but certificate creation failed. Run \`betty setup\`.`)

    console.log(`\n⚠️  Could not create a local certificate for ${domain}.`)
    console.log(`   Falling back to HTTP on port ${String(getHttpPort())} for this domain.`)
    return null
  }
}
