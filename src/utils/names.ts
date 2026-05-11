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

export const certificatePaths = (domain: string): { hostPath: string; keyPath: string; certFile: string; keyFile: string } => {
  const baseName = sanitizeName(domain)
  return {
    hostPath: path.join(BETTY_CERTS_DIR, `${baseName}.pem`),
    keyPath: path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`),
    certFile: `/certs/${baseName}.pem`,
    keyFile: `/certs/${baseName}-key.pem`,
  }
}
