import path from 'path'
import { BETTY_CERTS_DIR } from './constants'

export const sanitizeName = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9.-]/g, '-')
  .replace(/^-+|-+$/g, '')

export const certificatePaths = (domain: string): { hostPath: string; keyPath: string; certFile: string; keyFile: string } => {
  const baseName = sanitizeName(domain)
  return {
    hostPath: path.join(BETTY_CERTS_DIR, `${baseName}.pem`),
    keyPath: path.join(BETTY_CERTS_DIR, `${baseName}-key.pem`),
    certFile: `/certs/${baseName}.pem`,
    keyFile: `/certs/${baseName}-key.pem`,
  }
}
