import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { hostsEditScript } from './hosts'

// Runs the script the elevated PowerShell gets, unelevated, against a scratch
// file: the string checks in hosts.test.ts cannot tell whether it actually
// produces the right bytes. Windows PowerShell exists only on Windows.
const describeOnWindows = process.platform === 'win32' ? describe : describe.skip

describeOnWindows('elevated hosts script (Windows PowerShell)', () => {
  let dir: string
  let hostsPath: string
  let errorFile: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'betty-hosts-ps-'))
    hostsPath = path.join(dir, 'hosts')
    errorFile = path.join(dir, 'error.txt')
  })
  afterEach(() => {
    try { fs.chmodSync(hostsPath, 0o666) } catch { /* not created */ }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const run = (add: string[], remove: string[]): number => {
    const encoded = Buffer.from(hostsEditScript(hostsPath, { add, remove }, errorFile), 'utf16le').toString('base64')
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'pipe' })
      return 0
    } catch (err) {
      return (err as { status?: number }).status ?? 1
    }
  }

  // "# Büro" saved as Windows-1252: 0xFC is not valid UTF-8.
  const ansiComment = Buffer.concat([Buffer.from('# B'), Buffer.from([0xfc]), Buffer.from('ro')])

  test('appends without touching the rest of the file, CRLF and ANSI bytes included', () => {
    fs.writeFileSync(hostsPath, Buffer.concat([ansiComment, Buffer.from('\r\n127.0.0.1 localhost')]))

    expect(run(['a.test'], [])).toBe(0)

    expect(fs.readFileSync(hostsPath)).toEqual(Buffer.concat([
      ansiComment, Buffer.from('\r\n127.0.0.1 localhost\r\n127.0.0.1 a.test # added by betty\r\n'),
    ]))
  })

  test('removes Betty lines, keeps everything else byte for byte, and adds new ones', () => {
    fs.writeFileSync(hostsPath, Buffer.concat([
      ansiComment, Buffer.from('\r\n127.0.0.1 a.test # added by betty\r\n10.0.0.5 a.test\r\n127.0.0.1 b.test # added by betty\r\n'),
    ]))

    expect(run(['c.test'], ['a.test'])).toBe(0)

    expect(fs.readFileSync(hostsPath)).toEqual(Buffer.concat([
      ansiComment, Buffer.from('\r\n10.0.0.5 a.test\r\n127.0.0.1 b.test # added by betty\r\n127.0.0.1 c.test # added by betty\r\n'),
    ]))
  })

  test('adds nothing for a domain that already has a loopback entry', () => {
    fs.writeFileSync(hostsPath, '127.0.0.1 a.test\n')

    expect(run(['a.test'], [])).toBe(0)

    expect(fs.readFileSync(hostsPath, 'latin1')).toBe('127.0.0.1 a.test\n')
  })

  test('keeps a UTF-8 byte-order mark and the bytes after it when removing', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const umlaut = Buffer.from('# Büro\r\n', 'utf8')
    fs.writeFileSync(hostsPath, Buffer.concat([bom, umlaut, Buffer.from('127.0.0.1 a.test # added by betty\r\n')]))

    expect(run([], ['a.test'])).toBe(0)

    expect(fs.readFileSync(hostsPath)).toEqual(Buffer.concat([bom, umlaut]))
  })

  test('sees an entry on the first line behind a byte-order mark', () => {
    fs.writeFileSync(hostsPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('127.0.0.1 a.test\r\n')]))

    expect(run(['a.test'], [])).toBe(0)

    expect(fs.readFileSync(hostsPath).length).toBe(3 + '127.0.0.1 a.test\r\n'.length)
  })

  test('counts ::1 and tab-separated lines as entries, and adds each domain once', () => {
    fs.writeFileSync(hostsPath, '::1 a.test\n127.0.0.1\tb.test\n')

    expect(run(['a.test', 'b.test', 'c.test', 'C.test'], [])).toBe(0)

    expect(fs.readFileSync(hostsPath, 'latin1')).toBe('::1 a.test\n127.0.0.1\tb.test\n127.0.0.1 c.test # added by betty\n')
  })

  test('writes an empty hosts file with Windows line endings', () => {
    fs.writeFileSync(hostsPath, '')

    expect(run(['a.test'], [])).toBe(0)

    expect(fs.readFileSync(hostsPath, 'latin1')).toBe('127.0.0.1 a.test # added by betty\r\n')
  })

  test('reports why it failed, e.g. a read-only hosts file', () => {
    fs.writeFileSync(hostsPath, '127.0.0.1 localhost\r\n127.0.0.1 a.test # added by betty\r\n')
    fs.chmodSync(hostsPath, 0o444)

    expect(run([], ['a.test'])).toBe(1)

    expect(fs.readFileSync(errorFile, 'utf8')).toMatch(/denied|Zugriff|access/i)
  })
})
