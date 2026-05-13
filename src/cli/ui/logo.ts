const YELLOW = '\x1b[33m'
const GRAY = '\x1b[90m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

interface LogoFrame {
  topLeftCable: boolean
  middleHCable: boolean
  bottomLeftCable: boolean
  bottomRightCable: boolean
  bottomHLength: number
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

const renderFrame = ({ topLeftCable, middleHCable, bottomLeftCable, bottomRightCable }: LogoFrame): void => {
  const tl = topLeftCable ? `${YELLOW}│${RESET}` : ' '
  const bl = bottomLeftCable ? `${YELLOW}│${RESET}` : ' '
  const br = bottomRightCable ? `${YELLOW}│${RESET}` : ' '
  const mh = middleHCable ? `${YELLOW}───${RESET}` : '   '

  const logo = [
    `${GRAY}●   ●${RESET}`,
    `${tl}   `,
    `${GRAY}●${RESET}${mh}${GRAY}●${RESET}`,
    `${bl}   ${br}`,
    `${GRAY}●${RESET}${mh}${GRAY}●${RESET}`,
  ]

  console.log(logo[0])
  console.log(logo[1])
  console.log(logo[2] + '    betty')
  console.log(logo[3] + `    ${DIM}connects local domains to services${RESET}`)
  console.log(logo[4])
}

const FULL_FRAME: LogoFrame = {
  topLeftCable: true,
  middleHCable: true,
  bottomLeftCable: true,
  bottomRightCable: true,
  bottomHLength: 3,
}

const printBettyLogo = (): void => {
  console.log('')
  renderFrame(FULL_FRAME)
}

const animateBettyLogo = async (): Promise<void> => {
  if (!process.stdout.isTTY) {
    printBettyLogo()
    return
  }

  const frames: LogoFrame[] = [
    { topLeftCable: false, middleHCable: false, bottomLeftCable: false, bottomRightCable: false, bottomHLength: 0 },
    { topLeftCable: true,  middleHCable: false, bottomLeftCable: false, bottomRightCable: false, bottomHLength: 0 },
    { topLeftCable: true,  middleHCable: true,  bottomLeftCable: false, bottomRightCable: false, bottomHLength: 0 },
    { topLeftCable: true,  middleHCable: true,  bottomLeftCable: true,  bottomRightCable: false, bottomHLength: 0 },
    { topLeftCable: true,  middleHCable: true,  bottomLeftCable: true,  bottomRightCable: true,  bottomHLength: 0 },
    { topLeftCable: true,  middleHCable: true,  bottomLeftCable: true,  bottomRightCable: true,  bottomHLength: 1 },
    { topLeftCable: true,  middleHCable: true,  bottomLeftCable: true,  bottomRightCable: true,  bottomHLength: 2 },
    { topLeftCable: true,  middleHCable: true,  bottomLeftCable: true,  bottomRightCable: true,  bottomHLength: 3 },
  ]

  for (const frame of frames) {
    process.stdout.write('\x1Bc')
    renderFrame(frame)
    await sleep(100)
  }

  process.stdout.write('\x1Bc')
  printBettyLogo()
}

export { printBettyLogo, animateBettyLogo }
