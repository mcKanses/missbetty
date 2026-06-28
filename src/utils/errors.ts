// A recoverable, user-facing error raised by command logic. Throwing this
// instead of calling process.exit keeps the behavior layer free of process
// control, so it stays testable and reusable; the CLI entry point catches it
// and maps it to a printed error plus the exit code.
export class BettyError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'BettyError'
    this.exitCode = exitCode
  }
}
