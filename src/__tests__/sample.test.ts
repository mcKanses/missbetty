import { describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import { filterSystemOwnersForBettyPort, getDockerPortOwners, getSystemPortOwners } from '../utils/portOwners'

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

describe('portOwners', () => {
  describe('filterSystemOwnersForBettyPort', () => {
    test('returns all owners when Betty does not own the port', () => {
      const owners = ['nginx (PID 1)', 'node (PID 2)']
      expect(filterSystemOwnersForBettyPort(owners, false)).toEqual(owners)
    })

    test('filters known Docker Desktop relay processes when Betty owns port', () => {
      const owners = [
        'wslrelay (PID 1)',
        'com.docker.backend (PID 2)',
        'docker-proxy (PID 3)',
        'vpnkit (PID 4)',
        'nginx (PID 5)',
      ]
      expect(filterSystemOwnersForBettyPort(owners, true)).toEqual(['nginx (PID 5)'])
    })

    test('returns empty array when only relay processes remain', () => {
      const owners = ['wslrelay (PID 1)', 'com.docker.backend (PID 2)']
      expect(filterSystemOwnersForBettyPort(owners, true)).toEqual([])
    })

    test('does not filter unknown processes even when Betty owns port', () => {
      const owners = ['nginx (PID 1)', 'com.docker.backend (PID 2)']
      expect(filterSystemOwnersForBettyPort(owners, true)).toEqual(['nginx (PID 1)'])
    })
  })

  describe('getDockerPortOwners', () => {
    test('returns empty array when docker command fails', () => {
      ;(execSync as unknown as jest.Mock).mockImplementation(() => {
        throw new Error('docker not found')
      })

      expect(getDockerPortOwners(443)).toEqual([])
    })

    test('returns parsed container names from docker ps output', () => {
      ;(execSync as unknown as jest.Mock).mockReturnValue(
        Buffer.from('myapp\t0.0.0.0:443->443/tcp\n')
      )

      expect(getDockerPortOwners(443)).toEqual(['myapp\t0.0.0.0:443->443/tcp'])
    })
  })

  describe('getSystemPortOwners', () => {
    test('returns empty array when system command fails', () => {
      ;(execSync as unknown as jest.Mock).mockImplementation(() => {
        throw new Error('lsof not found')
      })

      expect(getSystemPortOwners(443)).toEqual([])
    })
  })
})
