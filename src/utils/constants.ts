import os from 'os'
import path from 'path'

export const BETTY_HOME_DIR = path.join(os.homedir(), '.betty')
export const BETTY_PROXY_COMPOSE = path.join(BETTY_HOME_DIR, 'docker-compose.yml')
export const BETTY_CONFIG_PATH = path.join(BETTY_HOME_DIR, 'config.json')
export const BETTY_DYNAMIC_DIR = path.join(BETTY_HOME_DIR, 'dynamic')
export const BETTY_CERTS_DIR = path.join(BETTY_HOME_DIR, 'certs')
export const BETTY_PROXY_NETWORK = 'betty_proxy'
export const BETTY_TRAEFIK_CONTAINER = 'betty-traefik'

export const TRAEFIK_COMPOSE = `
services:
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
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"
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
