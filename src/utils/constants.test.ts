import { describe, expect, jest, test } from '@jest/globals'

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}))

import {
  BETTY_HOME_DIR,
  BETTY_PROXY_COMPOSE,
  BETTY_CONFIG_PATH,
  BETTY_DYNAMIC_DIR,
  BETTY_CERTS_DIR,
  BETTY_PROXY_NETWORK,
  BETTY_TRAEFIK_CONTAINER,
  renderTraefikCompose,
} from './constants'

describe('path constants', () => {
  test('BETTY_HOME_DIR points to .betty in the home directory', () => {
    expect(BETTY_HOME_DIR.replace(/\\/g, '/')).toBe('/home/test-user/.betty')
  })

  test('BETTY_PROXY_COMPOSE is docker-compose.yml inside BETTY_HOME_DIR', () => {
    expect(BETTY_PROXY_COMPOSE.replace(/\\/g, '/')).toBe('/home/test-user/.betty/docker-compose.yml')
  })

  test('BETTY_CONFIG_PATH is config.json inside BETTY_HOME_DIR', () => {
    expect(BETTY_CONFIG_PATH.replace(/\\/g, '/')).toBe('/home/test-user/.betty/config.json')
  })

  test('BETTY_DYNAMIC_DIR is the dynamic subdirectory of BETTY_HOME_DIR', () => {
    expect(BETTY_DYNAMIC_DIR.replace(/\\/g, '/')).toBe('/home/test-user/.betty/dynamic')
  })

  test('BETTY_CERTS_DIR is the certs subdirectory of BETTY_HOME_DIR', () => {
    expect(BETTY_CERTS_DIR.replace(/\\/g, '/')).toBe('/home/test-user/.betty/certs')
  })
})

describe('network and container constants', () => {
  test('BETTY_PROXY_NETWORK is betty_proxy', () => {
    expect(BETTY_PROXY_NETWORK).toBe('betty_proxy')
  })

  test('BETTY_TRAEFIK_CONTAINER is betty-traefik', () => {
    expect(BETTY_TRAEFIK_CONTAINER).toBe('betty-traefik')
  })
})

describe('renderTraefikCompose', () => {
  const compose = renderTraefikCompose(80, 443)

  test('references the correct container name', () => {
    expect(compose).toContain(`container_name: ${BETTY_TRAEFIK_CONTAINER}`)
  })

  test('references the correct network name', () => {
    expect(compose).toContain(`network=${BETTY_PROXY_NETWORK}`)
    expect(compose).toContain(`- ${BETTY_PROXY_NETWORK}`)
  })

  test('maps the given host ports to container 80 and 443', () => {
    expect(compose).toContain('"80:80"')
    expect(compose).toContain('"443:443"')
  })

  test('publishes custom host ports while keeping container ports 80 and 443', () => {
    const custom = renderTraefikCompose(8080, 8443)
    expect(custom).toContain('"8080:80"')
    expect(custom).toContain('"8443:443"')
    // entrypoints inside the container stay standard
    expect(custom).toContain('--entrypoints.web.address=:80')
    expect(custom).toContain('--entrypoints.websecure.address=:443')
  })

  test('mounts the docker socket read-only', () => {
    expect(compose).toContain('/var/run/docker.sock:/var/run/docker.sock:ro')
  })
})
