import { describe, it, expect } from 'vitest'
import { extractReply } from '../src/runtime/subprocess-runtime.ts'

describe('extractReply', () => {
  it('returns whole output when no markers', () => {
    expect(extractReply('hello world')).toBe('hello world')
  })

  it('extracts between start and end markers (codex shape)', () => {
    const raw = `OpenAI Codex v0.128.0
--------
session id: abc
--------
user
What is 1+1?
codex
2
tokens used
16,081
2
`
    const reply = extractReply(raw, '\ncodex\n', '\ntokens used\n')
    expect(reply.trim()).toBe('2')
  })

  it('extracts after start marker when end is missing', () => {
    const raw = 'preamble\nResponse:\nthe answer'
    const reply = extractReply(raw, '\nResponse:\n')
    expect(reply.trim()).toBe('the answer')
  })

  it('strips ANSI escape codes', () => {
    expect(extractReply('\x1b[31mred\x1b[0m')).toBe('red')
  })

  it('falls through to whole output if start marker not found', () => {
    expect(extractReply('hello', '\nmissing\n')).toBe('hello')
  })
})
