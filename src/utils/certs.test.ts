import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { X509Certificate } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { checkCertificate } from './certs'

jest.mock('./setup', () => ({ checkMkcertInstalled: jest.fn(), getMkcertRootCaPath: jest.fn(() => null) }))

// A test CA, a second CA, and a certificate for app.test issued by the first,
// made with openssl. Times are given relative to the certificate's end date,
// so the checks do not depend on when they run.
const CA = `-----BEGIN CERTIFICATE-----
MIIBmDCCAT2gAwIBAgIUT7yv7/NWn1hfu8a/cgOfflm/pugwCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNYmV0dHkgdGVzdCBDQTAgFw0yNjEwMTExNDI1NTBaGA8yMTI2
MDkxNzE0MjU1MFowGDEWMBQGA1UEAwwNYmV0dHkgdGVzdCBDQTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABI9XrP1OzOvjU54jq0XiWzNlDNAS+2Jy4/q9KRicdvnw
6Fv9tQd3xNHyDaqX/YedkVVrzxBJ56paQy9oluC7O9WjYzBhMB0GA1UdDgQWBBQB
BvWY/49K8tABhyEbmRb7LfOSXjAfBgNVHSMEGDAWgBQBBvWY/49K8tABhyEbmRb7
LfOSXjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwICBDAKBggqhkjOPQQD
AgNJADBGAiEAqHtTmC3YR0Aj5T9lps1WfPA/77WLJRRS+JfklaCDVKICIQDBXMPS
JmI0q0cphDpOk6cfB8EbFQUHSxEoiKjEwaeAtg==
-----END CERTIFICATE-----`
const OTHER_CA = `-----BEGIN CERTIFICATE-----
MIIBjDCCATOgAwIBAgIUAiM+AKV5z6LkqE358f9YB1yzDg8wCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwIb3RoZXIgQ0EwIBcNMjYxMDExMTQyNTUwWhgPMjEyNjA5MTcx
NDI1NTBaMBMxETAPBgNVBAMMCG90aGVyIENBMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEOTNaJONVQ17AkVdAtYQWPn2Rb2ufg3EXgOEp98wjDcNUN+FoCnR2M22s
QWJr5I+Qv4nb8QFGYNWyN23LxPlOd6NjMGEwHQYDVR0OBBYEFBQJENlTKrjXiZd3
u16/bydTHd2jMB8GA1UdIwQYMBaAFBQJENlTKrjXiZd3u16/bydTHd2jMA8GA1Ud
EwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgIEMAoGCCqGSM49BAMCA0cAMEQCIFtH
LoJTQOv1+hq7l2jUVodMvlQpvvYHkReYId3SfQv6AiA6C+ZJp7/Vt1iYhMU7OZZR
6vGFytDyl2O3NugLmTs4pw==
-----END CERTIFICATE-----`
const LEAF = `-----BEGIN CERTIFICATE-----
MIIBhTCCASygAwIBAgIUG0XfbDM1VIAtAvu+eyuOO3hCIgIwCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNYmV0dHkgdGVzdCBDQTAeFw0yNjEwMTExNDI1NTBaFw0yOTAx
MTMxNDI1NTBaMBUxEzARBgNVBAoMCmJldHR5IHRlc3QwWTATBgcqhkjOPQIBBggq
hkjOPQMBBwNCAAQVTQS8ncbm1ha8BDBHbBppuuvso1uQ78hj3UWOZxeGSospCr0O
A4vopGrcvUMVZSxtF21vepEts70dZrcBgkKko1cwVTATBgNVHREEDDAKgghhcHAu
dGVzdDAdBgNVHQ4EFgQU1XcNpjnd4L44U7TxFJfhvU8BfBswHwYDVR0jBBgwFoAU
AQb1mP+PSvLQAYchG5kW+y3zkl4wCgYIKoZIzj0EAwIDRwAwRAIgSa/QvZ14m1Nz
+obhc6Uz6c0gy15yIU4jnM4d74WTt2QCIBGal9AO3mWbNDWBJlqJnHMBO86yJ86Q
+/ARN9sPmYjA
-----END CERTIFICATE-----`

const DAY_MS = 24 * 60 * 60_000
const validTo = new Date(new X509Certificate(LEAF).validTo).getTime()

describe('checkCertificate', () => {
  let dir: string
  let certPath: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'betty-certs-'))
    certPath = path.join(dir, 'app.test.pem')
    fs.writeFileSync(certPath, LEAF)
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  const check = (opts: { domain?: string; rootCa?: string; now: number }): ReturnType<typeof checkCertificate> =>
    checkCertificate(certPath, { domain: opts.domain, rootCa: new X509Certificate(opts.rootCa ?? CA), now: opts.now })

  test('accepts a certificate of the current CA that covers the domain and is far from expiring', () => {
    const result = check({ domain: 'app.test', now: validTo - 100 * DAY_MS })
    expect(result.problem).toBeNull()
    expect(result.domains).toEqual(['app.test'])
  })

  test('renews a month ahead of expiry, and an expired one', () => {
    expect(check({ now: validTo - 10 * DAY_MS }).problem).toMatch(/^expires on \d{4}-\d{2}-\d{2}$/)
    expect(check({ now: validTo + DAY_MS }).problem).toMatch(/^expired on /)
  })

  test('rejects a certificate issued by another CA, e.g. after the mkcert CA was recreated', () => {
    expect(check({ rootCa: OTHER_CA, now: validTo - 100 * DAY_MS }).problem).toBe('was issued by another CA than the current mkcert one')
  })

  test('rejects a certificate that does not cover the domain', () => {
    expect(check({ domain: 'other.test', now: validTo - 100 * DAY_MS }).problem).toBe('does not cover other.test')
  })

  test('reports a file that is no certificate', () => {
    fs.writeFileSync(certPath, 'not a certificate')
    expect(check({ now: validTo - 100 * DAY_MS }).problem).toBe('is unreadable')
  })
})
