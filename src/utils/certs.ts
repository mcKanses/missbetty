import { execFileSync } from 'child_process'
import { X509Certificate } from 'crypto'
import fs from 'fs'
import path from 'path'
import { BETTY_CERTS_DIR } from './constants'
import { checkMkcertInstalled, getMkcertRootCaPath } from './setup'

// mkcert certificates last 825 days. Renewed a month ahead, a project that is
// loaded now and then still never meets an expired one.
export const RENEW_BEFORE_DAYS = 30
const DAY_MS = 24 * 60 * 60_000

export interface CertificateCheck {
  // The certificate file in ~/.betty/certs.
  file: string;
  // The DNS names it covers.
  domains: string[];
  validTo: Date | null;
  // Why it needs renewing, or null when it does not.
  problem: string | null;
}

const readRootCa = (): X509Certificate | null => {
  const rootCaPath = getMkcertRootCaPath()
  if (rootCaPath === null) return null
  try {
    return new X509Certificate(fs.readFileSync(rootCaPath))
  } catch {
    return null
  }
}

const dnsNames = (cert: X509Certificate): string[] => (cert.subjectAltName ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.startsWith('DNS:'))
  .map((entry) => entry.slice(4))

// Checks a certificate betty created: expired or expiring soon, issued by a
// CA other than the current mkcert one (browsers reject it then, e.g. after
// the CA was recreated), or not covering the domain it serves. The root CA is
// passed in when many certificates are checked; without one the issuer is not
// judged.
export const checkCertificate = (certPath: string, opts: { domain?: string; rootCa?: X509Certificate | null; now?: number } = {}): CertificateCheck => {
  let cert: X509Certificate
  try {
    cert = new X509Certificate(fs.readFileSync(certPath))
  } catch {
    return { file: certPath, domains: [], validTo: null, problem: 'is unreadable' }
  }
  const domains = dnsNames(cert)
  const validTo = new Date(cert.validTo)
  const now = opts.now ?? Date.now()
  const rootCa = opts.rootCa === undefined ? readRootCa() : opts.rootCa
  let problem: string | null = null
  if (validTo.getTime() <= now) problem = `expired on ${validTo.toISOString().slice(0, 10)}`
  else if (validTo.getTime() - now < RENEW_BEFORE_DAYS * DAY_MS) problem = `expires on ${validTo.toISOString().slice(0, 10)}`
  else if (rootCa !== null && !(cert.checkIssued(rootCa) && cert.verify(rootCa.publicKey))) problem = 'was issued by another CA than the current mkcert one'
  else if (opts.domain !== undefined && cert.checkHost(opts.domain) === undefined) problem = `does not cover ${opts.domain}`
  return { file: certPath, domains, validTo, problem }
}

// Every certificate betty keeps, checked against the current mkcert CA.
export const checkAllCertificates = (now?: number): CertificateCheck[] => {
  let files: string[] = []
  try {
    files = fs.readdirSync(BETTY_CERTS_DIR).filter((file) => file.endsWith('.pem') && !file.endsWith('-key.pem'))
  } catch { /* no certificates yet */ }
  if (files.length === 0) return []
  const rootCa = readRootCa()
  return files.map((file) => checkCertificate(path.join(BETTY_CERTS_DIR, file), { rootCa, now }))
}

// Creates the certificates that need it again, for the names they cover, and
// returns those renewed. Without mkcert nothing can be renewed.
export const renewCertificates = (checks: CertificateCheck[]): CertificateCheck[] => {
  const due = checks.filter((check) => check.problem !== null && check.domains.length > 0)
  if (due.length === 0 || !checkMkcertInstalled()) return []
  const renewed: CertificateCheck[] = []
  for (const check of due) try {
    const keyPath = check.file.replace(/\.pem$/, '-key.pem')
    execFileSync('mkcert', ['-cert-file', check.file, '-key-file', keyPath, ...check.domains], { stdio: 'pipe' })
    console.log(`Renewed the certificate for ${check.domains.join(', ')} (${check.problem ?? ''}).`)
    renewed.push(check)
  } catch {
    console.log(`Warning: could not renew the certificate for ${check.domains.join(', ')}.`)
  }
  return renewed
}
