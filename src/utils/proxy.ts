import { execSync } from 'child_process'
import fs from 'fs'
import { printError, printHint } from '../cli/ui/output'
import { getDockerPortOwners, getSystemPortOwners, filterSystemOwnersForBettyPort } from './portOwners'
import {
  BETTY_TRAEFIK_CONTAINER,
  BETTY_HOME_DIR,
  BETTY_DYNAMIC_DIR,
  BETTY_CERTS_DIR,
  BETTY_PROXY_COMPOSE,
  BETTY_PROXY_NETWORK,
  TRAEFIK_COMPOSE,
} from './constants'

export const ensureHttpsPortAvailable = (): void => {
  const allDockerOwners = getDockerPortOwners(443)
  const bettyOwnsPort = allDockerOwners.some((owner) => owner.startsWith(BETTY_TRAEFIK_CONTAINER))
  const dockerOwners = allDockerOwners.filter((owner) => !owner.startsWith(BETTY_TRAEFIK_CONTAINER))
  if (bettyOwnsPort && dockerOwners.length === 0) return

  const systemOwners = filterSystemOwnersForBettyPort(getSystemPortOwners(443), bettyOwnsPort)

  if (dockerOwners.length === 0 && systemOwners.length === 0) return

  printError('Port 443 is already in use.')
  printHint('Betty needs host port 443 for HTTPS domains such as .dev.')
  if (dockerOwners.length > 0) {
    printHint('\nDocker containers publishing 443:')
    dockerOwners.forEach((owner) => { printHint(` - ${owner}`) })
  }
  if (systemOwners.length > 0) {
    printHint('\nProcesses listening on 443:')
    systemOwners.forEach((owner) => { printHint(` - ${owner}`) })
  }
  printHint('\nStop the conflicting HTTPS server or proxy, then run: betty serve')
  process.exit(1)
}

export const ensureProxySetup = (opts: { certs?: boolean } = {}): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) fs.mkdirSync(BETTY_DYNAMIC_DIR, { recursive: true })
  if (opts.certs === true && !fs.existsSync(BETTY_CERTS_DIR)) fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })
  if (!fs.existsSync(BETTY_PROXY_COMPOSE) || fs.readFileSync(BETTY_PROXY_COMPOSE, 'utf8') !== TRAEFIK_COMPOSE) {
    fs.writeFileSync(BETTY_PROXY_COMPOSE, TRAEFIK_COMPOSE, 'utf8')
    console.log(`Updated Docker Compose file: ${BETTY_PROXY_COMPOSE}`)
  }
}

export const ensureProxyNetwork = (): void => {
  try {
    execSync(`docker network inspect ${BETTY_PROXY_NETWORK}`, { stdio: 'pipe' })
  } catch {
    execSync(`docker network create ${BETTY_PROXY_NETWORK}`, { stdio: 'inherit' })
    console.log(`Created Docker network '${BETTY_PROXY_NETWORK}'.`)
  }
}

export const printProxyStartError = (message: string, command: string): void => {
  printError("Betty's proxy could not be started.")
  if (message.includes('permission denied') && message.includes('/var/run/docker.sock')) {
    printHint('Docker is installed, but your current shell has no access to /var/run/docker.sock.')
    printHint('Run one of these and retry:')
    printHint(' - newgrp docker')
    printHint(' - log out and log back in')
    printHint(`Then run: betty ${command}`)
    return
  }
  if (message.includes('Bind for 0.0.0.0:80 failed')) {
    printHint('Port 80 is already in use by another service.')
    printHint(`Stop the conflicting HTTP server or proxy, then run: betty ${command}`)
    return
  }
  if (message.includes('port is already allocated') || message.includes('Bind for 0.0.0.0:443 failed')) {
    printHint('Port 443 is already in use. Stop the other HTTPS server or proxy, then run: betty serve')
    printHint('Useful check: docker ps --format "table {{.Names}}\\t{{.Ports}}"')
    return
  }
  printHint(message)
}
