import path from 'path'
import { BETTY_CERTS_DIR } from './constants'

export const sanitizeName = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9.-]/g, '-')
  .replace(/^-+|-+$/g, '')

// Converts a Docker label value (project, service) into a valid DNS label segment.
// Dots are removed because a label segment must not contain them.
export const normalizeDomainLabel = (value: string): string => value
  .toLowerCase()
  .replace(/_/g, '-')
  .replace(/[^a-z0-9-]/g, '')
  .replace(/^-+|-+$/g, '')

// Converts a container name into a safe Traefik service/router key and route filename.
export const normalizeServiceName = (value: string): string => value
  .replace(/[^a-zA-Z0-9-]/g, '-')

// Underscores are not valid in hostnames, but browsers, Traefik and hosts files
// accept them and existing .betty.yml files use them, so they stay allowed.
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/i

// Validates a hostname before it reaches a Traefik Host() rule, a hosts file line
// or a shell command. Anything outside plain DNS labels (spaces, quotes, `$`)
// would corrupt those targets, so it is rejected up front.
export const validateDomain = (value: string): true | string => {
  const domain = value.trim()
  if (domain === '') return 'Domain cannot be empty'
  if (domain.length > 253 || !domain.split('.').every((label) => DOMAIN_LABEL.test(label))) return `Invalid domain '${domain}'. Use letters, digits, hyphens and underscores separated by dots, e.g. my-app.localhost`
  return true
}

export const certificatePaths =(domain: string): { hostPath: string; keyPath: string; certFile: string; keyFile: string } => {
  const baseName = sanitizeName(domain)
  return {
    hostPath: path.join(BETTY_CERTS_DIR, `${baseName}.pem`),
    keyPath: path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`),
    certFile: `/certs/${baseName}.pem`,
    keyFile: `/certs/${baseName}-key.pem`,
  }
}
