const YELLOW = '\x1b[33m'
const GRAY = '\x1b[90m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

interface LogoFrame {
  leftCable: boolean
  rightCable: boolean
  bottomCableLength: number
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

const renderFrame = ({ leftCable, rightCable, bottomCableLength }: LogoFrame): void => {
  const left = leftCable ? `${YELLOW}│${RESET}` : ' '
  const right = rightCable ? `${YELLOW}│${RESET}` : ' '
  const bottom = `${GRAY}●${RESET}${YELLOW}${'─'.repeat(bottomCableLength)}${RESET}${' '.repeat(3 - bottomCableLength)}${GRAY}●${RESET}`

  console.log(`${GRAY}●   ●${RESET}`)
  console.log(left)
  console.log(`${GRAY}●   ●${RESET}   betty`)
  console.log(`${left}   ${right}   ${DIM}local domains for docker${RESET}`)
  console.log(bottom)
}

export function printBettyLogo(): void {
  renderFrame({ leftCable: true, rightCable: true, bottomCableLength: 3 })
}

export async function animateBettyLogo(): Promise<void> {
  if (!process.stdout.isTTY) {
    printBettyLogo()
    return
  }

  const frames: LogoFrame[] = [
    { leftCable: false, rightCable: false, bottomCableLength: 0 },
    { leftCable: true, rightCable: false, bottomCableLength: 1 },
    { leftCable: true, rightCable: true, bottomCableLength: 2 },
    { leftCable: true, rightCable: true, bottomCableLength: 3 }
  ]

  for (const frame of frames) {
    process.stdout.write('\x1Bc')
    renderFrame(frame)
    await sleep(120)
  }

  process.stdout.write('\x1Bc')
  printBettyLogo()
}