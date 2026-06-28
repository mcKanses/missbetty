import { beforeEach, describe, expect, jest, it } from '@jest/globals'

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}))

jest.mock('./constants', () => ({
  BETTY_HOME_DIR: '/home/test/.betty',
  BETTY_STATE_PATH: '/home/test/.betty/links.json',
}))

import fs from 'fs'
import { getLinkContainer, setLinkContainer, removeLinkContainer } from './state'

const STATE_PATH = '/home/test/.betty/links.json'

beforeEach(() => {
  jest.clearAllMocks()
  ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(true)
})

describe('getLinkContainer', () => {
  it('returns the stored container for a route file', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ containers: { 'app.yml': 'web-1' } }))

    expect(getLinkContainer('app.yml')).toBe('web-1')
  })

  it('returns undefined when the file is not tracked', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ containers: {} }))

    expect(getLinkContainer('app.yml')).toBeUndefined()
  })

  it('returns undefined when the state file is missing or malformed', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockImplementation(() => { throw new Error('ENOENT') })

    expect(getLinkContainer('app.yml')).toBeUndefined()
  })
})

describe('setLinkContainer', () => {
  it('writes the container under the route file name, preserving other entries', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ containers: { 'other.yml': 'db-1' } }))

    setLinkContainer('app.yml', 'web-1')

    const written = (fs.writeFileSync as unknown as jest.Mock).mock.calls[0]
    expect(written[0]).toBe(STATE_PATH)
    const state = JSON.parse(String(written[1])) as { containers: Record<string, string> }
    expect(state.containers).toEqual({ 'other.yml': 'db-1', 'app.yml': 'web-1' })
  })

  it('creates the betty home directory when missing', () => {
    ;(fs.existsSync as unknown as jest.Mock).mockReturnValue(false)
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue('{}')

    setLinkContainer('app.yml', 'web-1')

    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test/.betty', { recursive: true })
  })
})

describe('removeLinkContainer', () => {
  it('removes the entry and writes the rest', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ containers: { 'app.yml': 'web-1', 'other.yml': 'db-1' } }))

    removeLinkContainer('app.yml')

    const state = JSON.parse(String((fs.writeFileSync as unknown as jest.Mock).mock.calls[0][1])) as { containers: Record<string, string> }
    expect(state.containers).toEqual({ 'other.yml': 'db-1' })
  })

  it('does not write when the entry is absent', () => {
    ;(fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify({ containers: {} }))

    removeLinkContainer('app.yml')

    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})
