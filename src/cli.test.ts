import { describe, expect, test } from '@jest/globals'
import type { Command } from 'commander'
import { createProgram } from './cli'

const command = (program: Command, name: string): Command => {
  const match = program.commands.find((cmd) => cmd.name() === name)
  if (match === undefined) throw new Error(`Missing command: ${name}`)
  return match
}

const optionFlags = (cmd: Command): string[] => cmd.options.map((option) => option.flags)

describe('cli command registration', () => {
  test('registers the public command surface', () => {
    const program = createProgram()

    expect(program.commands.map((cmd) => cmd.name())).toEqual([
      'project',
      'dev',
      'serve',
      'stop',
      'rest',
      'status',
      'link',
      'relink',
      'unlink',
      'config',
      'doctor',
      'setup',
    ])
  })

  test('keeps rest as a stop alias', () => {
    const program = createProgram()

    expect(command(program, 'stop').description()).toBe("Stop Betty's local switchboard service")
    expect(command(program, 'rest').description()).toBe("Alias for 'stop'")
  })

  test('registers status output options', () => {
    const flags = optionFlags(command(createProgram(), 'status'))

    expect(flags).toEqual(expect.arrayContaining([
      '--long',
      '--short',
      '--json',
      '--format <format>',
    ]))
  })

  test('registers dev project options', () => {
    const flags = optionFlags(command(createProgram(), 'dev'))

    expect(flags).toEqual(expect.arrayContaining([
      '--config <path>',
      '--dry-run',
    ]))
  })

  test('registers link and unlink safety options', () => {
    const program = createProgram()

    expect(optionFlags(command(program, 'link'))).toEqual(expect.arrayContaining([
      '--domain <domain>',
      '--port <port>',
      '--dry-run',
      '--open',
    ]))
    expect(optionFlags(command(program, 'unlink'))).toEqual(expect.arrayContaining([
      '--domain <domain>',
      '--all',
    ]))
  })

  test('registers setup repair option', () => {
    const flags = optionFlags(command(createProgram(), 'setup'))

    expect(flags).toEqual(expect.arrayContaining([
      '--fix',
    ]))
  })

  test('prints author information in commander help', () => {
    let output = ''
    createProgram()
      .configureOutput({ writeOut: (text: string) => { output += text } })
      .outputHelp()

    expect(output).toContain('Copyright (c) 2026\nby Arda Cansiz (https://github.com/mcKanses | https://linkedin.com/in/ardacansiz)')
    expect(output).toContain('Support Betty ❤️ https://github.com/sponsors/mcKanses | https://buymeacoffee.com/mckanses')
  })

  test('prints author information with version output', () => {
    expect(createProgram().version()).toContain('Copyright (c) 2026\nby Arda Cansiz (https://github.com/mcKanses | https://linkedin.com/in/ardacansiz)')
    expect(createProgram().version()).toContain('Support Betty ❤️ https://github.com/sponsors/mcKanses | https://buymeacoffee.com/mckanses')
  })
})
