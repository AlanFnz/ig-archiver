import { describe, it, expect } from 'vitest'
import { truncate } from '../lib/truncate'

describe('truncate', () => {
  it('returns the string unchanged when shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('returns the string unchanged when exactly at max', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and appends an ellipsis when longer than max', () => {
    expect(truncate('hello world', 5)).toBe('hello…')
  })

  it('handles an empty string', () => {
    expect(truncate('', 5)).toBe('')
  })

  it('handles max of 0', () => {
    expect(truncate('hello', 0)).toBe('…')
  })

  it('handles a URL-like string longer than max', () => {
    const url = 'https://www.instagram.com/p/AbCdEfGhIjKlMnOp/'
    expect(truncate(url, 20)).toBe('https://www.instagra…')
  })
})
