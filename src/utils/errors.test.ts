import { describe, expect, test } from '@jest/globals'
import { BettyError } from './errors'

describe('BettyError', () => {
  test('is an Error with name BettyError, a default exit code of 1 and no hints', () => {
    const error = new BettyError('something went wrong')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BettyError')
    expect(error.message).toBe('something went wrong')
    expect(error.exitCode).toBe(1)
    expect(error.hints).toEqual([])
  })

  test('accepts a custom exit code', () => {
    expect(new BettyError('fatal', { exitCode: 2 }).exitCode).toBe(2)
  })

  test('carries hint lines', () => {
    const error = new BettyError('port in use', { hints: ['stop the other proxy', ' - nginx-1'] })

    expect(error.hints).toEqual(['stop the other proxy', ' - nginx-1'])
  })
})
