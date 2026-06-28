import { describe, expect, test } from '@jest/globals'
import { BettyError } from './errors'

describe('BettyError', () => {
  test('is an Error with name BettyError and a default exit code of 1', () => {
    const error = new BettyError('something went wrong')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BettyError')
    expect(error.message).toBe('something went wrong')
    expect(error.exitCode).toBe(1)
  })

  test('accepts a custom exit code', () => {
    expect(new BettyError('fatal', 2).exitCode).toBe(2)
  })
})
