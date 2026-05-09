import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { execSync } from 'child_process'
import fs from 'fs'
import serveCommand from './serve'
import {
  getDockerPortOwners,
  getSystemPortOwners,
  filterSystemOwnersForBettyPort,
} from '../utils/portOwners'
import { printError, printHint } from '../cli/ui/output'

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}))

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}))

jest.mock('../utils/portOwners', () => ({
  __esModule: true,
  getDockerPortOwners: jest.fn(),
  getSystemPortOwners: jest.fn(),
  filterSystemOwnersForBettyPort: jest.fn(),
}))

jest.mock('../cli/ui/output', () => ({
  __esModule: true,
  printError: jest.fn(),
  printHint: jest.fn(),
}))

describe('serve command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue(['betty-traefik'])
    ;(getSystemPortOwners as unknown as jest.Mock).mockReturnValue([])
    ;(filterSystemOwnersForBettyPort as unknown as jest.Mock).mockReturnValue([])
  })

  test('starts global proxy successfully when dependencies are available', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker network inspect')) return Buffer.from('[]')
      return Buffer.from('ok')
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    serveCommand()

    const composeStart = (execSync as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).replace(/\\/g, '/').includes('docker compose -f "/home/test-user/.betty/docker-compose.yml" up -d')
    )
    expect(composeStart?.[1]).toEqual(expect.objectContaining({ stdio: 'inherit' }))
    expect(logSpy).toHaveBeenCalledWith('Starting global Betty Traefik proxy...')

    logSpy.mockRestore()
  })

  test('exits when HTTPS port is occupied by another container', () => {
    ;(getDockerPortOwners as unknown as jest.Mock).mockReturnValue(['other-container'])
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    expect(() => { serveCommand() }).toThrow('process-exit-1')
    expect(printError).toHaveBeenCalledWith('Port 443 is already in use.')

    exitSpy.mockRestore()
  })

  test('prints user hint when proxy start fails due to port 80 conflict', () => {
    ;(execSync as unknown as jest.Mock).mockImplementation((cmd: unknown) => {
      const command = String(cmd)
      if (command.includes('docker network inspect')) return Buffer.from('[]')
      if (command.includes('docker compose -f')) throw new Error('Bind for 0.0.0.0:80 failed')
      return Buffer.from('ok')
    })
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process-exit-${String(code)}`)
    })

    expect(() => { serveCommand() }).toThrow('process-exit-1')
    expect(printHint).toHaveBeenCalledWith('Port 80 is already in use by another service.')

    exitSpy.mockRestore()
  })
})
