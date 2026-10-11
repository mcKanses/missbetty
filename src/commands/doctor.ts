import path from 'path'
import { printHint } from '../cli/ui/output'
import { checkAllCertificates } from '../utils/certs'
import { BettyError } from '../utils/errors'
import { hostsEntryProblem, isWsl } from '../utils/hosts'
import { collectSetupStatus } from '../utils/setup'

export const statusLine = (label: string, ok: boolean, detail?: string): void => {
  const icon = ok ? '✓' : '✗'
  if (detail !== undefined && detail !== '') {
    console.log(`${icon} ${label} (${detail})`)
    return
  }
  console.log(`${icon} ${label}`)
}

// Exits non-zero when Docker, a hosts entry or a valid certificate is missing,
// so scripts can tell.
// mkcert is optional: without it Betty serves HTTP only.
const doctorCommand = (): void => {
  const status = collectSetupStatus()

  statusLine('Docker installed', status.dockerInstalled)
  statusLine('Docker running', status.dockerRunning)
  statusLine('mkcert installed', status.mkcertInstalled)
  // The CA files exist; whether browsers trust them only `mkcert -install` can
  // tell and fix, which `betty setup` runs.
  statusLine('mkcert CA created', status.mkcertCaInstalled)
  if (status.linkedDomains.length === 0) statusLine('hosts entries (no linked domains need one)', true)
  for (const domain of status.linkedDomains) {
    const ok = !status.missingHostsEntries.includes(domain)
    statusLine(`hosts entry for ${domain}`, ok, ok ? undefined : hostsEntryProblem(domain))
  }

  const certificates = checkAllCertificates()
  const certificateProblems = certificates.filter((check) => check.problem !== null)
  if (certificateProblems.length === 0) statusLine(`certificates (${String(certificates.length)} valid)`, true)
  for (const check of certificateProblems) statusLine(`certificate for ${check.domains.join(', ') || path.basename(check.file)}`, false, check.problem ?? undefined)

  if (isWsl() && status.mkcertCaInstalled) printHint('WSL: browsers on Windows trust only CAs in the Windows store. Run mkcert -install on Windows as well, with CAROOT pointing at the same CA.')

  if (!status.dockerInstalled || !status.dockerRunning || status.missingHostsEntries.length > 0 || certificateProblems.length > 0) throw new BettyError('Some checks failed. `betty setup` fixes what it can.')
}

export default doctorCommand