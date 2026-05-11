import { collectSetupStatus } from '../utils/setup'

export const statusLine = (label: string, ok: boolean, detail?: string): void => {
  const icon = ok ? '✓' : '✗'
  if (detail !== undefined && detail !== '') {
    console.log(`${icon} ${label} (${detail})`)
    return
  }
  console.log(`${icon} ${label}`)
}

const doctorCommand = (): void => {
  const status = collectSetupStatus()

  statusLine('Docker installed', status.dockerInstalled)
  statusLine('Docker running', status.dockerRunning)
  statusLine('mkcert installed', status.mkcertInstalled)
  statusLine('mkcert CA installed', status.mkcertCaInstalled)
  statusLine(`hosts entry exists for ${status.domain}`, status.hostsEntryExists)
}

export default doctorCommand