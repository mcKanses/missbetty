import { afterEach, beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('child_process', () => ({ execSync: jest.fn() }))

import { execSync } from 'child_process'
import { getDockerPortOwners, getSystemPortOwners, filterSystemOwnersForBettyPort } from './portOwners'

beforeEach(() => {
  jest.resetAllMocks()
})

describe('getDockerPortOwners', () => {
  it('returns container lines when containers publish the port', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue(
      'nginx-1\t0.0.0.0:443->443/tcp\ntraefik-1\t0.0.0.0:443->443/tcp'
    )

    expect(getDockerPortOwners(443)).toEqual([
      'nginx-1\t0.0.0.0:443->443/tcp',
      'traefik-1\t0.0.0.0:443->443/tcp',
    ])
  })

  it('returns empty array when no containers publish the port', () => {
    ;(execSync as unknown as jest.Mock).mockReturnValue('')

    expect(getDockerPortOwners(443)).toEqual([])
  })

  it('returns empty array when docker command fails', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('docker not found') })

    expect(getDockerPortOwners(443)).toEqual([])
  })
})

describe('getSystemPortOwners', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('uses lsof on linux and skips the header line', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    ;(execSync as unknown as jest.Mock).mockReturnValue('COMMAND  PID  USER\nnginx  1234  root')

    expect(getSystemPortOwners(443)).toEqual(['nginx  1234  root'])
  })

  it('uses PowerShell on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    ;(execSync as unknown as jest.Mock).mockReturnValue('nginx (PID 1234)')

    expect(getSystemPortOwners(443)).toEqual(['nginx (PID 1234)'])
  })

  it('returns empty array when command fails', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('lsof: command not found') })

    expect(getSystemPortOwners(443)).toEqual([])
  })

  it('returns empty array when port is not in use', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    ;(execSync as unknown as jest.Mock).mockReturnValue('COMMAND  PID  USER')

    expect(getSystemPortOwners(443)).toEqual([])
  })
})

describe('filterSystemOwnersForBettyPort', () => {
  it('returns all owners as-is when betty does not own the port', () => {
    const owners = ['wslrelay', 'nginx (pid 1234)']

    expect(filterSystemOwnersForBettyPort(owners, false)).toEqual(owners)
  })

  it('filters wslrelay, com.docker.backend, docker-proxy and vpnkit when betty owns the port', () => {
    const owners = [
      'wslrelay (pid 10)',
      'com.docker.backend (pid 20)',
      'docker-proxy (pid 30)',
      'vpnkit (pid 40)',
    ]

    expect(filterSystemOwnersForBettyPort(owners, true)).toEqual([])
  })

  it('keeps real system processes when betty owns the port', () => {
    const owners = ['wslrelay (pid 10)', 'nginx (pid 1234)']

    expect(filterSystemOwnersForBettyPort(owners, true)).toEqual(['nginx (pid 1234)'])
  })

  it('returns empty array when owners list is empty', () => {
    expect(filterSystemOwnersForBettyPort([], true)).toEqual([])
    expect(filterSystemOwnersForBettyPort([], false)).toEqual([])
  })
})
