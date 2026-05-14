import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mn-mod-'))
process.env.MODELNEXUS_DATA_DIR = tmp
delete process.env.ANTHROPIC_API_KEY
delete process.env.OPENAI_API_KEY

const { closeDb } = await import('../src/daemon/db.ts')
const { createChat } = await import('../src/daemon/chat-store.ts')
const { appendMessage } = await import('../src/daemon/message-bus.ts')
const { pickSpeaker } = await import('../src/routing/moderator.ts')

describe('moderator', () => {
  afterAll(() => {
    closeDb()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('routes coding questions to a coding-strong model', async () => {
    const chat = createChat({
      task: 't',
      models: ['claude-opus-4-7', 'codex-cli', 'gemini-2-5-pro'],
    })
    const m = appendMessage({
      chat_id: chat.id,
      speaker_id: 'user',
      kind: 'user',
      content: 'Please refactor this function and fix the bug in the TypeScript class.',
    })
    const pick = await pickSpeaker(chat.id, [m], chat.models_json ? JSON.parse(chat.models_json) : [])
    expect(['codex-cli', 'claude-opus-4-7']).toContain(pick.speaker_id)
    expect(pick.source).toBe('capability')
  })

  it('honors @-mentions', async () => {
    const chat = createChat({ task: 't', models: ['claude-opus-4-7', 'gpt-5'] })
    const m = appendMessage({
      chat_id: chat.id,
      speaker_id: 'user',
      kind: 'user',
      content: '@gpt-5 what do you think about this math problem?',
    })
    const pick = await pickSpeaker(chat.id, [m], ['claude-opus-4-7', 'gpt-5'])
    expect(pick.speaker_id).toBe('gpt-5')
    expect(pick.source).toBe('mention')
  })

  it('falls back to round-robin for vague prompts', async () => {
    const chat = createChat({ task: 't', models: ['claude-opus-4-7', 'gpt-5'] })
    const m = appendMessage({
      chat_id: chat.id,
      speaker_id: 'user',
      kind: 'user',
      content: 'hmm',
    })
    const pick = await pickSpeaker(chat.id, [m], ['claude-opus-4-7', 'gpt-5'])
    expect(['claude-opus-4-7', 'gpt-5']).toContain(pick.speaker_id)
    expect(pick.source).toBe('round_robin')
  })
})
