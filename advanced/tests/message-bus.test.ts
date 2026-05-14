import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mn-test-'))
process.env.MODELNEXUS_DATA_DIR = tmp

const { closeDb } = await import('../src/daemon/db.ts')
const { appendMessage, fetchMessages } = await import('../src/daemon/message-bus.ts')
const { createChat } = await import('../src/daemon/chat-store.ts')
const { recordCompletionSignal } = await import('../src/daemon/completion.ts')

describe('message bus', () => {
  afterAll(() => {
    closeDb()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('appends 1000 messages and reads via cursor', () => {
    const chat = createChat({ task: 'load test', models: ['m1', 'm2'] })

    for (let i = 0; i < 1000; i++) {
      appendMessage({
        chat_id: chat.id,
        speaker_id: i % 2 === 0 ? 'm1' : 'm2',
        kind: 'speaker',
        content: `msg ${i}`,
      })
    }

    let cursor: string | undefined
    let total = 0
    for (let i = 0; i < 20; i++) {
      const page = fetchMessages({ chat_id: chat.id, since_cursor: cursor, limit: 100 })
      total += page.messages.length
      cursor = page.next_cursor ?? undefined
      if (!cursor) break
    }
    expect(total).toBe(1000)
  })

  it('cursor stops at no-next', () => {
    const chat = createChat({ task: 'small', models: ['m1'] })
    appendMessage({ chat_id: chat.id, speaker_id: 'm1', kind: 'speaker', content: 'hi' })
    const page = fetchMessages({ chat_id: chat.id, limit: 100 })
    expect(page.messages.length).toBe(1)
    expect(page.next_cursor).toBeNull()
  })

  it('completion requires 2 distinct signals + min duration', () => {
    const chat = createChat({ task: 'fast', models: ['m1', 'm2'], min_duration_minutes: 0 })
    const r1 = recordCompletionSignal(chat.id, 'm1')
    expect(r1.accepted).toBe(true)
    expect(r1.disbanded).toBe(false)
    // same speaker — duplicate
    const r1b = recordCompletionSignal(chat.id, 'm1')
    expect(r1b.disbanded).toBe(false)
    const r2 = recordCompletionSignal(chat.id, 'm2')
    expect(r2.disbanded).toBe(true)
  })

  it('completion blocked by min duration even with 2 signals', () => {
    const chat = createChat({ task: 'slow', models: ['m1', 'm2'], min_duration_minutes: 10 })
    recordCompletionSignal(chat.id, 'm1')
    const r = recordCompletionSignal(chat.id, 'm2')
    expect(r.disbanded).toBe(false)
    expect(r.reason).toMatch(/min duration/)
  })
})
