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

  test('reports why it failed, e.g. a read-only hosts file', () => {
    fs.writeFileSync(hostsPath, '127.0.0.1 localhost\r\n127.0.0.1 a.test # added by betty\r\n')
    fs.chmodSync(hostsPath, 0o444)

    expect(run([], ['a.test'])).toBe(1)

    expect(fs.readFileSync(errorFile, 'utf8')).toMatch(/denied|Zugriff|access/i)
  })
})
