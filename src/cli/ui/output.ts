const R = '\x1b[1;31m'
const Y = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

export const printError = (msg: string): void => {
  console.error(`${R}Error:${RESET} ${msg}`)
}

export const printWarn = (msg: string): void => {
  console.error(`${Y}Warning:${RESET} ${msg}`)
}

export const printHint = (msg: string): void => {
  console.error(`${DIM}${msg}${RESET}`)
}
