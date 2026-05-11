import { afterEach, beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('child_process', () => ({ execSync: jest.fn() }))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
  },
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
}))

import fs from 'fs'
import { execSync } from 'child_process'
import { ensureHostsEntry, removeHostsEntry } from './hosts'

const originalPlatform = process.platform
const originalEnv = { ...process.env }

beforeEach(() => {
  jest.resetAllMocks()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  process.env.USERDOMAIN = originalEnv.USERDOMAIN
  process.env.USERNAME = originalEnv.USERNAME
  process.env.WSL_DISTRO_NAME = originalEnv.WSL_DISTRO_NAME
})

const setPlatform = (platform: string): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('ensureHostsEntry', () => {
  it('returns true without reading hosts for .localhost domains', () => {
    expect(ensureHostsEntry('myapp.localhost')).toBe(true)
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('returns true when entry already exists in hosts file', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 myapp.dev # added by betty\n')

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).not.toHaveBeenCalled()
  })

  it('appends entry when domain is not in hosts file and returns true', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('127.0.0.1 myapp.dev'),
      'utf8'
    )
  })

  it('continues to append when initial readFileSync fails', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementationOnce(() => { throw new Error('ENOENT') })

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).toHaveBeenCalled()
  })

  it('returns false and warns when running in WSL', () => {
    setPlatform('linux')
    process.env.WSL_DISTRO_NAME = 'Ubuntu'

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
    expect(fs.appendFileSync).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalled()
  })

  it('uses sudo fallback when append fails on linux and returns true', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock)
      .mockReturnValueOnce('127.0.0.1 other.dev\n')
      .mockReturnValueOnce('127.0.0.1 myapp.dev # added by betty\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('sudo sh -c'),
      expect.anything()
    )
  })

  it('returns false when append fails on linux and sudo also fails', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('sudo failed') })

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
  })

  it('uses PowerShell elevation when append fails on win32 and returns true', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock)
      .mockImplementationOnce(() => { throw new Error('EACCES') })
      .mockImplementationOnce(() => undefined)
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('EncodedCommand'),
      expect.anything()
    )
  })

  it('returns false when elevation fails on win32', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('elevation failed') })

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
  })

  it('returns false when elevation succeeds but append still fails on win32', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
  })
})

describe('removeHostsEntry', () => {
  it('returns true for empty domain without reading hosts', () => {
    expect(removeHostsEntry('')).toBe(true)
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('returns true for .localhost domains without reading hosts', () => {
    expect(removeHostsEntry('myapp.localhost')).toBe(true)
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('returns true when domain is not in hosts file without writing', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('removes matching lines and writes the cleaned content back', () => {
    setPlatform('linux')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      '127.0.0.1 other.dev\n127.0.0.1 myapp.dev # added by betty\n'
    )

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/etc/hosts',
      expect.not.stringContaining('myapp.dev'),
      'utf8'
    )
  })

  it('returns false when readFileSync fails on linux', () => {
    setPlatform('linux')
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })

    expect(removeHostsEntry('myapp.dev')).toBe(false)
  })

  it('uses PowerShell elevation when write fails on win32 and returns true', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      '127.0.0.1 myapp.dev # added by betty\n'
    )
    ;(fs.writeFileSync as unknown as jest.Mock)
      .mockImplementationOnce(() => { throw new Error('EACCES') })
      .mockImplementationOnce(() => undefined)
    ;(execSync as unknown as jest.Mock).mockReturnValue(undefined)

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('EncodedCommand'),
      expect.anything()
    )
  })

  it('returns false when elevation fails on win32', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('elevation failed') })

    expect(removeHostsEntry('myapp.dev')).toBe(false)
  })
})
