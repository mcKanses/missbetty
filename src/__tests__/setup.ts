// Commands only prompt with a terminal (src/utils/prompt.ts). Jest's stdin is
// none in CI, so tests start as if run interactively; tests of the non-TTY
// path set isTTY themselves.
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true })
