import { describe, it, expect, vi, afterEach } from 'vitest'
import { log } from '../cli'

describe('cli log()', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('prefixes messages with a local timestamp', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    log(false, 'hello')
    expect(err).toHaveBeenCalledOnce()
    expect(err.mock.calls[0][0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hello$/)
  })

  it('treats undefined quiet as loud', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    log(undefined, 'hello')
    expect(err).toHaveBeenCalledOnce()
  })

  it('stays silent when quiet', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    log(true, 'hello')
    expect(err).not.toHaveBeenCalled()
  })
})
