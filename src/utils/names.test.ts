import { describe, expect, jest, test } from '@jest/globals'
import { sanitizeName, certificatePaths, normalizeDomainLabel, normalizeServiceName } from './names'

jest.mock('./constants', () => ({
  BETTY_CERTS_DIR: '/home/test-user/.betty/certs',
}))

describe('sanitizeName', () => {
  test('leaves a clean lowercase domain unchanged', () => {
    expect(sanitizeName('app.dev')).toBe('app.dev')
  })

  test('converts uppercase letters to lowercase', () => {
    expect(sanitizeName('MyApp')).toBe('myapp')
  })

  test('replaces spaces with hyphens', () => {
    expect(sanitizeName('my app')).toBe('my-app')
  })

  test('replaces underscores with hyphens', () => {
    expect(sanitizeName('my_project')).toBe('my-project')
  })

  test('replaces special characters with hyphens', () => {
    expect(sanitizeName('app@v2.dev')).toBe('app-v2.dev')
  })

  test('strips leading hyphens', () => {
    expect(sanitizeName('--app.dev')).toBe('app.dev')
  })

  test('strips trailing hyphens', () => {
    expect(sanitizeName('app.dev--')).toBe('app.dev')
  })

  test('preserves dots and numbers', () => {
    expect(sanitizeName('app123.localhost')).toBe('app123.localhost')
  })

  test('handles mixed case with special characters', () => {
    expect(sanitizeName('My_App@2.Dev')).toBe('my-app-2.dev')
  })
})

describe('certificatePaths', () => {
  test('returns correct cert and key paths for a simple domain', () => {
    const result = certificatePaths('app.dev')

    expect(result.hostPath.replace(/\\/g, '/')).toBe('/home/test-user/.betty/certs/app.dev.pem')
    expect(result.keyPath.replace(/\\/g, '/')).toBe('/home/test-user/.betty/certs/app.dev-key.pem')
    expect(result.certFile).toBe('/certs/app.dev.pem')
    expect(result.keyFile).toBe('/certs/app.dev-key.pem')
  })

  test('sanitizes the domain before building paths', () => {
    const result = certificatePaths('My App')

    expect(result.hostPath.replace(/\\/g, '/')).toContain('my-app.pem')
    expect(result.keyPath.replace(/\\/g, '/')).toContain('my-app-key.pem')
    expect(result.certFile).toBe('/certs/my-app.pem')
    expect(result.keyFile).toBe('/certs/my-app-key.pem')
  })

  test('certFile and keyFile are always relative to /certs/', () => {
    const result = certificatePaths('any.domain.localhost')

    expect(result.certFile).toMatch(/^\/certs\//)
    expect(result.keyFile).toMatch(/^\/certs\//)
  })
})

describe('normalizeDomainLabel', () => {
  test('lowercases the value', () => {
    expect(normalizeDomainLabel('MyApp')).toBe('myapp')
  })

  test('converts underscores to hyphens', () => {
    expect(normalizeDomainLabel('my_project')).toBe('my-project')
  })

  test('removes dots', () => {
    expect(normalizeDomainLabel('my.project')).toBe('myproject')
  })

  test('strips leading and trailing hyphens', () => {
    expect(normalizeDomainLabel('--app--')).toBe('app')
  })

  test('removes all non-alphanumeric-hyphen characters', () => {
    expect(normalizeDomainLabel('app@v2!')).toBe('appv2')
  })

  test('returns empty string for blank input', () => {
    expect(normalizeDomainLabel('')).toBe('')
  })
})

describe('normalizeServiceName', () => {
  test('leaves alphanumeric-hyphen names unchanged', () => {
    expect(normalizeServiceName('my-app')).toBe('my-app')
  })

  test('replaces underscores with hyphens', () => {
    expect(normalizeServiceName('my_app')).toBe('my-app')
  })

  test('replaces dots with hyphens', () => {
    expect(normalizeServiceName('my.app')).toBe('my-app')
  })

  test('preserves original casing', () => {
    expect(normalizeServiceName('MyApp')).toBe('MyApp')
  })

  test('replaces special characters with hyphens', () => {
    expect(normalizeServiceName('app@v2!')).toBe('app-v2-')
  })
})
