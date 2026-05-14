import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mn-know-'))
process.env.MODELNEXUS_DATA_DIR = tmp
delete process.env.OPENAI_API_KEY

const { closeDb } = await import('../src/daemon/db.ts')
const { createChat } = await import('../src/daemon/chat-store.ts')
const { buildKnowledgeTools } = await import('../src/knowledge/tools.ts')
const { ledgerPath } = await import('../src/knowledge/ledger.ts')
const { listNodes } = await import('../src/knowledge/graph.ts')

describe('knowledge tools', () => {
  afterAll(() => {
    closeDb()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('note + recall roundtrip without embeddings (keyword fallback)', async () => {
    const chat = createChat({ task: 't', models: ['claude', 'gpt'] })
    const tools = buildKnowledgeTools()
    const note = tools.find(t => t.name === 'nexus_note')!
    const recall = tools.find(t => t.name === 'nexus_recall')!

    const ctxA = {
      chat_id: chat.id,
      speaker_id: 'claude',
      profile: { id: 'claude', runtime: 'api', strengths: [], cost_class: 'high' } as never,
      system_prompt: '',
      task: 't',
    }
    const ctxB = { ...ctxA, speaker_id: 'gpt' }

    const r1 = await note.handler(
      { kind: 'decision', content: 'We will use TokenBucket for rate limiting in ApiGateway' },
      ctxA
    )
    expect(r1).toMatch(/noted/)

    const found = await recall.handler({ query: 'rate limiting algorithm', k: 5 }, ctxB)
    expect(found).toMatch(/TokenBucket/)

    expect(existsSync(ledgerPath(chat.id))).toBe(true)
    const ledger = readFileSync(ledgerPath(chat.id), 'utf8')
    expect(ledger).toMatch(/Decisions/)
    expect(ledger).toMatch(/TokenBucket/)

    const nodes = listNodes(chat.id)
    const labels = nodes.map(n => n.label)
    expect(labels).toContain('TokenBucket')
    expect(labels).toContain('ApiGateway')
  })
})
