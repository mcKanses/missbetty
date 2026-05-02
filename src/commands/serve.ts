import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { printError, printHint } from '../cli/ui/output'
import {
  getDockerPortOwners,
  getSystemPortOwners,
  filterSystemOwnersForBettyPort,
} from '../utils/portOwners'

const BETTY_HOME_DIR = path.join(os.homedir(), '.betty')
const BETTY_PROXY_NETWORK = 'betty_proxy'
const BETTY_TRAEFIK_CONTAINER = 'betty-traefik'
const BETTY_PROXY_COMPOSE = path.join(BETTY_HOME_DIR, 'docker-compose.yml')
const BETTY_DYNAMIC_DIR = path.join(BETTY_HOME_DIR, 'dynamic')
const BETTY_CERTS_DIR = path.join(BETTY_HOME_DIR, 'certs')

const traefikCompose = `services:
  traefik:
    image: traefik:v2.10
    container_name: ${BETTY_TRAEFIK_CONTAINER}
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=${BETTY_PROXY_NETWORK}
      - --providers.file.directory=/dynamic
      - --providers.file.watch=true
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./dynamic:/dynamic:ro
      - ./certs:/certs:ro
    networks:
      - ${BETTY_PROXY_NETWORK}

networks:
  ${BETTY_PROXY_NETWORK}:
    external: true
    name: ${BETTY_PROXY_NETWORK}
`

const ensureBettyHome = (): void => {
  if (!fs.existsSync(BETTY_HOME_DIR)) {
    fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
    console.log(`Created global Betty directory: ${BETTY_HOME_DIR}`)
  }
}

const ensureDynamicDir = (): void => {
  if (!fs.existsSync(BETTY_DYNAMIC_DIR)) {
    fs.mkdirSync(BETTY_DYNAMIC_DIR, { recursive: true })
    console.log(`Created Betty dynamic config directory: ${BETTY_DYNAMIC_DIR}`)
  }
}

const ensureCertsDir = (): void => {
  if (!fs.existsSync(BETTY_CERTS_DIR)) {
    fs.mkdirSync(BETTY_CERTS_DIR, { recursive: true })
    console.log(`Created Betty certs directory: ${BETTY_CERTS_DIR}`)
  }
}

const ensureComposeFile = (): void => {
  if (!fs.existsSync(BETTY_PROXY_COMPOSE)) {
    fs.writeFileSync(BETTY_PROXY_COMPOSE, traefikCompose, 'utf8')
    console.log(`Created Docker Compose file: ${BETTY_PROXY_COMPOSE}`)
    return
  }

  const current = fs.readFileSync(BETTY_PROXY_COMPOSE, 'utf8')
  if (current !== traefikCompose) {
    fs.writeFileSync(BETTY_PROXY_COMPOSE, traefikCompose, 'utf8')
    console.log(`Updated Docker Compose file: ${BETTY_PROXY_COMPOSE}`)
  }
}

const ensureProxyNetwork = (): void => {
  try {
    execSync(`docker network inspect ${BETTY_PROXY_NETWORK}`, { stdio: 'pipe' })
  } catch {
    execSync(`docker network create ${BETTY_PROXY_NETWORK}`, { stdio: 'inherit' })
    console.log(`Created Docker network '${BETTY_PROXY_NETWORK}'.`)
  }
}

const ensureHttpsPortAvailable = (): void => {
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

const printProxyStartError = (message: string): void => {
  printError('Traefik proxy could not be started.')
  if (message.includes('Bind for 0.0.0.0:80 failed')) {
    printHint('Port 80 is already in use by another service.')
    printHint('Betty no longer needs host port 80. Run "betty serve" once to rewrite the global compose file.')
    return
  }
  if (message.includes('port is already allocated') || message.includes('Bind for 0.0.0.0:443 failed')) {
    printHint('Port 443 is already in use. Stop the other HTTPS server or proxy, then run: betty serve')
    printHint('Useful check: docker ps --format "table {{.Names}}\\t{{.Ports}}"')
    return
  }
  printHint(message)
}

const serveCommand = (): void => {
  try {
    ensureBettyHome()
    ensureDynamicDir()
    ensureCertsDir()
    ensureComposeFile()
    ensureProxyNetwork()
    ensureHttpsPortAvailable()

    console.log('Starting global Betty Traefik proxy...')
    execSync(`docker compose -f "${BETTY_PROXY_COMPOSE}" up -d`, {
      cwd: BETTY_HOME_DIR,
      stdio: 'inherit',
    })
    console.log(`Traefik proxy is running as '${BETTY_TRAEFIK_CONTAINER}' on port 443.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printProxyStartError(message)
    process.exit(1)
  }
}

export default serveCommand
