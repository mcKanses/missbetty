import { afterEach, beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('child_process', () => ({ execSync: jest.fn(), execFileSync: jest.fn() }))

// The kernel name decides WSL when WSL_DISTRO_NAME is gone (sudo, env -i); a
// fixed non-WSL value keeps these tests independent of where they run.
const mockKernel = { release: 'generic' }
jest.mock('os', () => ({
  __esModule: true,
  default: { release: () => mockKernel.release, tmpdir: () => '/tmp', homedir: () => '/home/test' },
  release: () => mockKernel.release,
  tmpdir: () => '/tmp',
  homedir: () => '/home/test',
}))

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    rmSync: jest.fn(),
  },
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  rmSync: jest.fn(),
}))

import fs from 'fs'
import { execFileSync } from 'child_process'
import { ensureHostsEntries, ensureHostsEntry, hasHostsEntry, removeHostsEntries, removeHostsEntry } from './hosts'

const originalPlatform = process.platform
const originalEnv = { ...process.env }

beforeEach(() => {
  jest.resetAllMocks()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  if (originalEnv.USERDOMAIN === undefined) delete process.env.USERDOMAIN
  else process.env.USERDOMAIN = originalEnv.USERDOMAIN
  if (originalEnv.USERNAME === undefined) delete process.env.USERNAME
  else process.env.USERNAME = originalEnv.USERNAME
  if (originalEnv.WSL_DISTRO_NAME === undefined) delete process.env.WSL_DISTRO_NAME
  else process.env.WSL_DISTRO_NAME = originalEnv.WSL_DISTRO_NAME
})

const setPlatform = (platform: string): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

// The PowerShell script Betty elevated, decoded from its -EncodedCommand argument.
const elevatedScript = (): string => {
  const calls = (execFileSync as unknown as jest.Mock).mock.calls as [string, string[]][]
  const command = calls[calls.length - 1]?.[1]?.[2] ?? ''
  const encoded = /'-EncodedCommand','([^']+)'/.exec(command)?.[1] ?? ''
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

describe('hasHostsEntry', () => {
  it('treats .localhost domains as present without reading hosts', () => {
    expect(hasHostsEntry('myapp.localhost')).toBe(true)
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('reads /etc/hosts on Linux', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 myapp.dev # added by betty\n')

    expect(hasHostsEntry('myapp.dev')).toBe(true)
    expect(fs.readFileSync).toHaveBeenCalledWith('/etc/hosts', 'latin1')
  })

  it('reads the Windows hosts file under WSL, where Betty writes the entry', () => {
    setPlatform('linux')
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 myapp.dev # added by betty\n')

    expect(hasHostsEntry('myapp.dev')).toBe(true)
    expect(fs.readFileSync).toHaveBeenCalledWith('/mnt/c/Windows/System32/drivers/etc/hosts', 'latin1')
  })

  it('does not match a domain that only shares a prefix', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 myapp.dev.example # added by betty\n')

    expect(hasHostsEntry('myapp.dev')).toBe(false)
  })

  it('ignores a commented-out entry', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('# 127.0.0.1 myapp.dev\n127.0.0.1 other.dev # myapp.dev\n')

    expect(hasHostsEntry('myapp.dev')).toBe(false)
  })

  it('returns false when the hosts file cannot be read', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })

    expect(hasHostsEntry('myapp.dev')).toBe(false)
  })
})

describe('ensureHostsEntry', () => {
  it('returns true without reading hosts for .localhost domains', () => {
    expect(ensureHostsEntry('myapp.localhost')).toBe(true)
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('appends an entry when the domain only appears in a commented-out line', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('# 127.0.0.1 myapp.dev\n')

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).toHaveBeenCalledWith('/etc/hosts', expect.stringContaining('127.0.0.1 myapp.dev # added by betty'), 'latin1')
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
      'latin1'
    )
  })

  it('appends in the file\'s CRLF style without adding blank lines', () => {
    setPlatform('win32')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\r\n')

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).toHaveBeenCalledWith(expect.any(String), '127.0.0.1 myapp.dev # added by betty\r\n', 'latin1')
  })

  it('starts a new line first when the file does not end with one', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost')

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).toHaveBeenCalledWith('/etc/hosts', '\n127.0.0.1 myapp.dev # added by betty\n', 'latin1')
  })

  it('continues to append on a line of its own when the hosts file cannot be read', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    // The file may not end with a line break, so the entry must not join its last line.
    expect(fs.appendFileSync).toHaveBeenCalledWith('/etc/hosts', '\n127.0.0.1 myapp.dev # added by betty\n', 'latin1')
  })

  it('treats an existing entry in other letter case as present, like the elevated script does', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 MyApp.dev\n')

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).not.toHaveBeenCalled()
  })

  it('writes to the Windows hosts file on WSL when it is writable', () => {
    setPlatform('linux')
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockReturnValue(undefined)

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      '/mnt/c/Windows/System32/drivers/etc/hosts',
      expect.stringContaining('myapp.dev'),
      'latin1'
    )
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('falls back to manual instructions on WSL when the Windows hosts file is not writable', () => {
    setPlatform('linux')
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('uses sudo fallback when append fails on linux and returns true', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    let written = false
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() =>
      written ? '127.0.0.1 other.dev\n127.0.0.1 myapp.dev # added by betty\n' : '127.0.0.1 other.dev\n'
    )
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { written = true })

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    expect(execFileSync).toHaveBeenCalledWith(
      'sudo',
      ['tee', '-a', '/etc/hosts'],
      expect.objectContaining({ input: Buffer.from('127.0.0.1 myapp.dev # added by betty\n', 'latin1') })
    )
  })

  it('returns false when append fails on linux and sudo also fails', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('sudo failed') })

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
  })

  it('appends from an elevated PowerShell on win32 without widening the hosts ACL', () => {
    setPlatform('win32')
    let elevated = false
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() =>
      elevated ? '127.0.0.1 other.dev\n127.0.0.1 myapp.dev # added by betty\n' : '127.0.0.1 other.dev\n'
    )
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { elevated = true })

    expect(ensureHostsEntry('myapp.dev')).toBe(true)
    const script = elevatedScript()
    expect(script).toContain("$add = @('myapp.dev')")
    expect(script).not.toMatch(/Set-Acl|AddAccessRule/)
    // Only domain names travel; the elevated script reads the file itself, so the
    // command stays short however large the hosts file is.
    expect(script).not.toContain('other.dev')
  })

  it('returns false when elevation fails on win32', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('elevation failed') })

    expect(ensureHostsEntry('myapp.dev')).toBe(false)
  })

  it('returns false when elevation succeeds but append still fails on win32', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 other.dev\n')
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(undefined)

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

  it('does not match words of the marker comment, e.g. a domain named "betty"', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 app.dev # added by betty\n127.0.0.1 betty # added by betty\n')

    expect(removeHostsEntry('betty')).toBe(true)
    expect(fs.writeFileSync).toHaveBeenCalledWith('/etc/hosts', '127.0.0.1 app.dev # added by betty\n', 'latin1')
  })

  it('keeps CRLF line endings and adds no trailing blank line when removing', () => {
    setPlatform('win32')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('127.0.0.1 localhost\r\n127.0.0.1 app.dev # added by betty\r\n')

    expect(removeHostsEntry('app.dev')).toBe(true)
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), '127.0.0.1 localhost\r\n', 'latin1')
  })

  it('leaves a commented-out line alone', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('# 127.0.0.1 app.dev # added by betty\n')

    expect(removeHostsEntry('app.dev')).toBe(true)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
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
      'latin1'
    )
  })

  it('targets the Windows hosts file under WSL', () => {
    setPlatform('linux')
    process.env.WSL_DISTRO_NAME = 'Ubuntu'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      '127.0.0.1 myapp.dev # added by betty\n'
    )

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/mnt/c/Windows/System32/drivers/etc/hosts',
      expect.not.stringContaining('myapp.dev'),
      'latin1'
    )
  })

  it('keeps user-added lines without the betty marker and does not write', () => {
    setPlatform('linux')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      '127.0.0.1 myapp.dev\n'
    )

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('removes only the betty-marked line and keeps a user line for the same domain', () => {
    setPlatform('linux')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(
      '127.0.0.1 myapp.dev\n127.0.0.1 myapp.dev # added by betty\n'
    )

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    const written = (fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1] as string
    expect(written).toContain('127.0.0.1 myapp.dev\n')
    expect(written).not.toContain('# added by betty')
  })

  it('returns false when readFileSync fails on linux', () => {
    setPlatform('linux')
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })

    expect(removeHostsEntry('myapp.dev')).toBe(false)
  })

  it('rewrites from an elevated PowerShell on win32 without widening the hosts ACL', () => {
    setPlatform('win32')
    let elevated = false
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() =>
      elevated ? '127.0.0.1 other.dev\n' : '127.0.0.1 other.dev\n127.0.0.1 myapp.dev # added by betty\n'
    )
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { elevated = true })

    expect(removeHostsEntry('myapp.dev')).toBe(true)
    const script = elevatedScript()
    expect(script).toContain("$remove = @('myapp.dev')")
    expect(script).not.toMatch(/Set-Acl|AddAccessRule/)
    expect(script).not.toContain('other.dev')
  })

  it('returns false when elevation fails on win32', () => {
    setPlatform('win32')
    process.env.USERDOMAIN = 'WORKSTATION'
    process.env.USERNAME = 'testuser'
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('elevation failed') })

    expect(removeHostsEntry('myapp.dev')).toBe(false)
  })
})

describe('batched hosts edits', () => {
  it('adds several domains on Windows with a single elevation prompt', () => {
    setPlatform('win32')
    let elevated = false
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() =>
      elevated ? '127.0.0.1 a.dev # added by betty\r\n127.0.0.1 b.dev # added by betty\r\n' : ''
    )
    ;(fs.appendFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation(() => { elevated = true })

    expect(ensureHostsEntries(['a.dev', 'b.dev', 'c.localhost'])).toBe(true)
    expect(execFileSync).toHaveBeenCalledTimes(1)
    expect(elevatedScript()).toContain("$add = @('a.dev', 'b.dev')")
  })

  it('keeps the elevated command short however large the hosts file is', () => {
    setPlatform('win32')
    const bigHosts = `${'127.0.0.1 filler.example # some long comment\r\n'.repeat(400)}127.0.0.1 app.dev # added by betty\r\n`
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(bigHosts)
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockReturnValue(undefined)

    removeHostsEntry('app.dev')

    const command = ((execFileSync as unknown as jest.Mock).mock.calls[0][1] as string[]).join(' ')
    expect(bigHosts.length).toBeGreaterThan(15000)
    expect(command.length).toBeLessThan(8191)
  })

  it('removes entries on Linux through sudo tee when /etc/hosts is not writable', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    let written = false
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() =>
      written ? '127.0.0.1 localhost\n' : '127.0.0.1 localhost\n127.0.0.1 a.test # added by betty\n127.0.0.1 b.test # added by betty\n'
    )
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation((_cmd: unknown, args: unknown) => { if ((args as string[]).includes('tee')) written = true })

    expect(removeHostsEntries(['a.test', 'b.test'])).toBe(true)
    expect(execFileSync).toHaveBeenNthCalledWith(1, 'sudo', ['-v'], expect.anything())
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'sudo', ['-n', 'tee', '/etc/hosts'], expect.objectContaining({ input: Buffer.from('127.0.0.1 localhost\n', 'latin1') }))
  })

  it('keeps lines added to /etc/hosts while sudo waited for the password', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    let file = '127.0.0.1 localhost\n127.0.0.1 a.test # added by betty\n'
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => file)
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation((_cmd: unknown, args: unknown, opts: unknown) => {
      // A VPN client adds a line while the password prompt is open.
      if ((args as string[])[0] === '-v') file += '10.0.0.5 vpn.internal\n'
      else file = String((opts as { input: Buffer }).input)
    })

    expect(removeHostsEntry('a.test')).toBe(true)
    expect(file).toBe('127.0.0.1 localhost\n10.0.0.5 vpn.internal\n')
  })

  it('does not count a blocklist mapping as an entry, and warns about it', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('0.0.0.0 app.test\n')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(hasHostsEntry('app.test')).toBe(false)
    ensureHostsEntry('app.test')

    expect(fs.appendFileSync).toHaveBeenCalledWith('/etc/hosts', '127.0.0.1 app.test # added by betty\n', 'latin1')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('also mapped to 0.0.0.0'))
    logSpy.mockRestore()
  })

  it('keeps non-UTF-8 bytes of the hosts file when rewriting it', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    // "# Büro" saved as Windows-1252: 0xFC is not valid UTF-8.
    const original = Buffer.concat([Buffer.from('# B'), Buffer.from([0xfc]), Buffer.from('ro\n127.0.0.1 a.test # added by betty\n')]).toString('latin1')
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(original)

    removeHostsEntry('a.test')

    const [, written, encoding] = (fs.writeFileSync as unknown as jest.Mock).mock.calls[0] as [string, string, BufferEncoding]
    expect(Buffer.from(written, encoding)).toEqual(Buffer.concat([Buffer.from('# B'), Buffer.from([0xfc]), Buffer.from('ro\n')]))
  })

  it('never writes an invalid host name', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')

    expect(ensureHostsEntries(["x'; Remove-Item C:\\ ; '.test", 'bad\nline.test'])).toBe(true)
    expect(fs.appendFileSync).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('detects WSL from the kernel name when WSL_DISTRO_NAME was dropped, e.g. by sudo', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    mockKernel.release = '5.15.167.4-microsoft-standard-WSL2'
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    try {
      hasHostsEntry('app.test')
      expect(fs.readFileSync).toHaveBeenCalledWith('/mnt/c/Windows/System32/drivers/etc/hosts', 'latin1')
    } finally {
      mockKernel.release = 'generic'
    }
  })

  it('does not count an entry that a foreign mapping before it overrides', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('10.0.0.5 a.test\n127.0.0.1 a.test # added by betty\n')

    expect(hasHostsEntry('a.test')).toBe(false)
  })

  it('reads an entry on the first line behind a UTF-8 byte-order mark', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('127.0.0.1 a.test\n')]).toString('latin1'))

    expect(hasHostsEntry('a.test')).toBe(true)
  })

  it('warns about a skipped invalid host name', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    ensureHostsEntries(['bad host.test'])

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped hosts entry for 'bad host.test'"))
    logSpy.mockRestore()
  })

  it('writes nothing through sudo when /etc/hosts cannot be read again', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    let reads = 0
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => {
      reads++
      if (reads > 1) throw new Error('EIO')
      return '127.0.0.1 a.test # added by betty\n'
    })
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })

    expect(removeHostsEntry('a.test')).toBe(false)
    expect(execFileSync).not.toHaveBeenCalledWith('sudo', expect.arrayContaining(['tee']), expect.anything())
  })

  it('asks sudo again when it caches no credentials', () => {
    setPlatform('linux')
    delete process.env.WSL_DISTRO_NAME
    let file = '127.0.0.1 a.test # added by betty\n'
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => file)
    ;(fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('EACCES') })
    ;(execFileSync as unknown as jest.Mock).mockImplementation((_cmd: unknown, args: unknown, opts: unknown) => {
      if ((args as string[])[0] === '-n') throw new Error('a password is required')
      if ((args as string[])[0] === 'tee') file = String((opts as { input: Buffer }).input)
    })

    expect(removeHostsEntry('a.test')).toBe(true)
    expect(execFileSync).toHaveBeenLastCalledWith('sudo', ['tee', '/etc/hosts'], expect.anything())
  })
})
