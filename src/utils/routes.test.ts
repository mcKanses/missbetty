import path from 'path'
import { beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    mkdirSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
}))

jest.mock('yaml', () => ({
  __esModule: true,
  default: { parse: jest.fn(), stringify: jest.fn() },
  parse: jest.fn(),
  stringify: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_DYNAMIC_DIR: '/home/test-user/.betty/dynamic',
}))

jest.mock('./state', () => ({
  __esModule: true,
  getLinkContainer: jest.fn(),
  setLinkContainer: jest.fn(),
  removeLinkContainer: jest.fn(),
}))

import fs from 'fs'
import yaml from 'yaml'
import { readRoutes, findDomainConflict, writeRouteConfig } from './routes'
import { getLinkContainer, setLinkContainer, removeLinkContainer } from './state'

const DYNAMIC_DIR = '/home/test-user/.betty/dynamic'

const makeDoc = (routerName: string, domain: string, target: string) => ({
  http: {
    routers: {
      [routerName]: { rule: `Host("${domain}")`, entryPoints: ['web'], service: routerName },
    },
    services: {
      [routerName]: { loadBalancer: { servers: [{ url: target }] } },
    },
  },
})

beforeEach(() => {
  jest.resetAllMocks()
})

describe('readRoutes', () => {
  it('returns empty array when dynamic dir does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    expect(readRoutes()).toEqual([])
  })

  it('returns empty array when no yaml files in directory', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['readme.md', 'config.json'])
    expect(readRoutes()).toEqual([])
  })

  it('parses a valid route file', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp', 'myapp.dev', 'http://172.20.0.2:3000'))

    const routes = readRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      fileName: 'myapp.yml',
      routerName: 'myapp',
      domain: 'myapp.dev',
      target: 'http://172.20.0.2:3000',
      port: '3000',
    })
  })

  it('reads the source container from the betty-container comment', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp-dev.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('# betty-container: myapp\nhttp: {}')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp-dev', 'myapp.dev', 'http://172.20.0.2:3000'))

    expect(readRoutes()[0].container).toBe('myapp')
  })

  it('prefers the container from the link state over the comment', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp-dev.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('# betty-container: from-comment\nhttp: {}')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp-dev', 'myapp.dev', 'http://172.20.0.2:3000'))
    ;(getLinkContainer as unknown as jest.Mock).mockReturnValue('from-state')

    expect(readRoutes()[0].container).toBe('from-state')
  })

  it('falls back to the router name as container when no comment is present', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp', 'myapp.dev', 'http://172.20.0.2:3000'))

    expect(readRoutes()[0].container).toBe('myapp')
  })

  it('prefers the non-secure router when both exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue({
      http: {
        routers: {
          'myapp-secure': { rule: 'Host("myapp.dev")', entryPoints: ['websecure'], service: 'myapp', tls: {} },
          myapp: { rule: 'Host("myapp.dev")', entryPoints: ['web'], service: 'myapp' },
        },
        services: { myapp: { loadBalancer: { servers: [{ url: 'http://172.20.0.2:3000' }] } } },
      },
    })

    expect(readRoutes()[0].routerName).toBe('myapp')
  })

  it('falls back to the first router when only a secure router exists', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue({
      http: {
        routers: {
          'myapp-secure': { rule: 'Host("myapp.dev")', entryPoints: ['websecure'], service: 'myapp', tls: {} },
        },
        services: { myapp: { loadBalancer: { servers: [{ url: 'http://172.20.0.2:3000' }] } } },
      },
    })

    const routes = readRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ routerName: 'myapp-secure', domain: 'myapp.dev', port: '3000' })
  })

  it('falls back to the file name as router when the file has no routers', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['empty.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue({ http: {} })

    const routes = readRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ routerName: 'empty', domain: '', target: '', port: '' })
  })

  it('extracts port from target url', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp', 'myapp.dev', 'http://172.20.0.2:8080'))

    expect(readRoutes()[0].port).toBe('8080')
  })

  it('skips malformed files and returns remaining routes', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['bad.yml', 'good.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock)
      .mockImplementationOnce(() => { throw new Error('invalid yaml') })
      .mockReturnValueOnce(makeDoc('good', 'good.dev', 'http://172.20.0.2:80'))

    const routes = readRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0].domain).toBe('good.dev')
  })

  it('returns one entry per non-secure router for multi-domain files', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['project.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue({
      http: {
        routers: {
          'project-1': { rule: 'Host("ui.dev")', entryPoints: ['web'], service: 'project-1' },
          'project-1-secure': { rule: 'Host("ui.dev")', entryPoints: ['websecure'], service: 'project-1', tls: {} },
          'project-2': { rule: 'Host("api.dev")', entryPoints: ['web'], service: 'project-2' },
          'project-2-secure': { rule: 'Host("api.dev")', entryPoints: ['websecure'], service: 'project-2', tls: {} },
        },
        services: {
          'project-1': { loadBalancer: { servers: [{ url: 'http://host.docker.internal:5173' }] } },
          'project-2': { loadBalancer: { servers: [{ url: 'http://host.docker.internal:8080' }] } },
        },
      },
    })

    const routes = readRoutes()
    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({ routerName: 'project-1', domain: 'ui.dev', target: 'http://host.docker.internal:5173', port: '5173' })
    expect(routes[1]).toMatchObject({ routerName: 'project-2', domain: 'api.dev', target: 'http://host.docker.internal:8080', port: '8080' })
  })
})

describe('findDomainConflict', () => {
  it('returns null when dynamic dir does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    expect(findDomainConflict('myapp.dev')).toBeNull()
  })

  it('returns null when domain is not linked', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['other.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('other', 'other.dev', 'http://172.20.0.2:80'))

    expect(findDomainConflict('myapp.dev')).toBeNull()
  })

  it('returns conflict info when domain is already linked', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp', 'myapp.dev', 'http://172.20.0.2:3000'))

    expect(findDomainConflict('myapp.dev')).toEqual({ fileName: 'myapp.yml', routerName: 'myapp' })
  })

  it('is case-insensitive', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp', 'myapp.dev', 'http://172.20.0.2:3000'))

    expect(findDomainConflict('MYAPP.DEV')).not.toBeNull()
  })

  it('detects a conflict when two different domains normalize to the same route file', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['a-b-localhost.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('a-b-localhost', 'a-b.localhost', 'http://172.20.0.2:3000'))

    // 'a.b.localhost' is a different domain but normalizes to the same name.
    expect(findDomainConflict('a.b.localhost')).toEqual({ fileName: 'a-b-localhost.yml', routerName: 'a-b-localhost' })
  })

  it('ignores the specified file path', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as unknown as jest.Mock).mockReturnValue(['myapp.yml'])
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('content')
    ;(yaml.parse as unknown as jest.Mock).mockReturnValue(makeDoc('myapp', 'myapp.dev', 'http://172.20.0.2:3000'))

    const ignoreFilePath = path.join(DYNAMIC_DIR, 'myapp.yml')
    expect(findDomainConflict('myapp.dev', ignoreFilePath)).toBeNull()
  })
})

describe('writeRouteConfig', () => {
  const NEXT_PATH = path.join(DYNAMIC_DIR, 'myapp-dev.yml')

  beforeEach(() => {
    ;(yaml.stringify as unknown as jest.Mock).mockReturnValue('yaml-content')
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
  })

  it('derives the file name from the domain and writes the rendered config', () => {
    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null)

    expect(fs.writeFileSync).toHaveBeenCalledWith(NEXT_PATH, expect.stringContaining('yaml-content'), 'utf8')
  })

  it('stores the source container in a leading comment', () => {
    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null)

    expect(fs.writeFileSync).toHaveBeenCalledWith(NEXT_PATH, expect.stringContaining('# betty-container: myapp'), 'utf8')
  })

  it('records the container in the link state under the route file name', () => {
    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null)

    expect(setLinkContainer).toHaveBeenCalledWith('myapp-dev.yml', 'myapp')
  })

  it('creates dynamic dir when it does not exist', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)

    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null)

    expect(fs.mkdirSync).toHaveBeenCalledWith(DYNAMIC_DIR, { recursive: true })
  })

  it('passes config with http-only router when no certificate given', () => {
    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null)

    const config = (yaml.stringify as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    const routers = (config.http as { routers: Record<string, unknown> }).routers
    expect(Object.keys(routers)).toEqual(['myapp-dev'])
    expect(routers['myapp-dev-secure']).toBeUndefined()
  })

  it('adds secure router and tls block when certificate is provided', () => {
    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, { certFile: '/certs/myapp.dev.pem', keyFile: '/certs/myapp.dev-key.pem' })

    const config = (yaml.stringify as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    const routers = (config.http as { routers: Record<string, unknown> }).routers
    expect(routers['myapp-dev-secure']).toBeDefined()
    expect(config.tls).toBeDefined()
  })

  it('deletes old file when oldFilePath differs from new path', () => {
    const oldFilePath = path.join(DYNAMIC_DIR, 'old-name.yml')

    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null, oldFilePath)

    expect(fs.unlinkSync).toHaveBeenCalledWith(oldFilePath)
    expect(removeLinkContainer).toHaveBeenCalledWith('old-name.yml')
  })

  it('does not delete old file when oldFilePath matches new path', () => {
    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null, NEXT_PATH)

    expect(fs.unlinkSync).not.toHaveBeenCalled()
  })

  it('logs "Updated" when oldFilePath is provided, "Wrote" otherwise', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Wrote'))

    jest.clearAllMocks()
    ;(yaml.stringify as unknown as jest.Mock).mockReturnValue('yaml-content')
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)

    writeRouteConfig('myapp', 'myapp.dev', '172.20.0.2', 3000, null, path.join(DYNAMIC_DIR, 'old.yml'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated'))

    consoleSpy.mockRestore()
  })
})
