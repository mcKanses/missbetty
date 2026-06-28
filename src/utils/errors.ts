// A recoverable, user-facing error raised by command logic. Throwing this
// instead of calling process.exit keeps the behavior layer free of process
// control, so it stays testable and reusable; the CLI entry point catches it
// and maps it to a printed error (plus any hint lines) and the exit code.
export interface BettyErrorOptions {
  exitCode?: number;
  // Extra diagnostic lines printed after the error message, in order, as hints.
  // Lets rich diagnostics (e.g. a list of conflicting port owners) survive the
  // throw without baking formatting into the message.
  hints?: string[];
}

export class BettyError extends Error {
  readonly exitCode: number
  readonly hints: string[]

  constructor(message: string, options: BettyErrorOptions = {}) {
    super(message)
    this.name = 'BettyError'
    this.exitCode = options.exitCode ?? 1
    this.hints = options.hints ?? []
  }
}
