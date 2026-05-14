// mnx — the helper that tmux-spawned CLI agents (claude, codex, gemini, aider)
// run from their shell to interact with the shared knowledge graph.
//
// Usage from inside a tmux agent session:
//   mnx note decision "we will use token-bucket rate limiting"
//   mnx recall "rate limiting algorithm"
//   mnx complete            # signal that this agent considers the task done
//   mnx say "thinking out loud..."   # post a free-form message
//
// The active chat id and speaker id are picked up from env vars that the
// TmuxRuntime sets when it spawns the session:
//   MODELNEXUS_CHAT_ID, MODELNEXUS_SPEAKER_ID

import { loadEnv } from '../env.ts'
loadEnv()

import { getOrCreateToken } from '../daemon/auth.ts'

const PORT = parseInt(process.env.MODELNEXUS_PORT ?? '24000', 10)
const HOST = process.env.MODELNEXUS_HOST ?? '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

const usage = (): never => {
  console.error(`mnx — ModelNexus knowledge helper for CLI agents

  mnx note <kind> <content>     append to shared ledger + KG (kinds: decision, finding, hypothesis, question, todo)
  mnx recall <query> [k]        search shared knowledge
  mnx say <content>             post a free-form chat message
  mnx complete                  signal task completion (>=2 agents agreeing disbands the chat)
  mnx peers                     list current chat members
  mnx history [N]               print last N messages (default 10)

Required env (set by the TmuxRuntime spawner):
  MODELNEXUS_CHAT_ID, MODELNEXUS_SPEAKER_ID
`)
  process.exit(2)
}

const fail = (msg: string): never => {
  console.error(`mnx: ${msg}`)
  process.exit(1)
}

const chatId = process.env.MODELNEXUS_CHAT_ID ?? fail('MODELNEXUS_CHAT_ID not set')
const speakerId = process.env.MODELNEXUS_SPEAKER_ID ?? fail('MODELNEXUS_SPEAKER_ID not set')

const api = async (path: string, opts: { method?: string; body?: unknown } = {}): Promise<unknown> => {
  const r = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getOrCreateToken()}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!r.ok) fail(`${r.status}: ${await r.text()}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

const [, , cmd, ...rest] = process.argv

const main = async (): Promise<void> => {
  switch (cmd) {
    case 'note': {
      const kind = rest[0]
      const content = rest.slice(1).join(' ')
      if (!kind || !content) usage()
      const { upsertVecEntry } = await import('../knowledge/vector.ts')
      const { appendLedgerEntry } = await import('../knowledge/ledger.ts')
      const { upsertNodes, linkCoOccurring } = await import('../knowledge/graph.ts')
      appendLedgerEntry(chatId, speakerId, kind, content)
      await upsertVecEntry(chatId, kind, `[${kind}] ${content}`)
      const nodes = upsertNodes(chatId, content)
      linkCoOccurring(chatId, nodes, `co_${kind}`)
      await api(`/chats/${chatId}/say`, {
        method: 'POST',
        body: {
          speaker_id: speakerId,
          kind: 'note',
          content,
          metadata: { kind, entities: nodes.map(n => n.label) },
        },
      })
      console.log(`noted (${kind}). entities: ${nodes.map(n => n.label).join(', ') || 'none'}`)
      return
    }
    case 'recall': {
      const query = rest.slice(0, -1).join(' ') || rest.join(' ')
      const kArg = rest.length > 1 ? parseInt(rest[rest.length - 1], 10) : NaN
      const k = Number.isFinite(kArg) ? kArg : 5
      const q = Number.isFinite(kArg) ? rest.slice(0, -1).join(' ') : rest.join(' ')
      if (!q) usage()
      const { searchVec } = await import('../knowledge/vector.ts')
      const { listNodes } = await import('../knowledge/graph.ts')
      const hits = await searchVec(chatId, q, k)
      const nodes = listNodes(chatId).filter(n => q.toLowerCase().includes(n.label.toLowerCase()))
      if (hits.length === 0 && nodes.length === 0) {
        console.log('(no relevant prior notes found)')
        return
      }
      if (hits.length) {
        console.log('# prior notes')
        for (const h of hits) console.log(`- (${h.kind}) ${h.content}`)
      }
      if (nodes.length) {
        console.log('\n# known entities')
        for (const n of nodes) console.log(`- ${n.label}`)
      }
      void query
      return
    }
    case 'say': {
      const content = rest.join(' ')
      if (!content) usage()
      await api(`/chats/${chatId}/say`, {
        method: 'POST',
        body: { speaker_id: speakerId, kind: 'speaker', content },
      })
      console.log('sent')
      return
    }
    case 'complete': {
      const r = (await api(`/chats/${chatId}/complete`, {
        method: 'POST',
        body: { speaker_id: speakerId },
      })) as { signals: number; disbanded: boolean; reason: string }
      console.log(`signal recorded (${r.signals} total). ${r.disbanded ? 'CHAT DISBANDED' : r.reason}`)
      return
    }
    case 'peers': {
      const r = (await api(`/chats/${chatId}`)) as { chat: { models_json: string } }
      const peers = (JSON.parse(r.chat.models_json) as string[]).filter(p => p !== speakerId)
      console.log(peers.join('\n') || '(no peers)')
      return
    }
    case 'history': {
      const n = parseInt(rest[0] ?? '10', 10) || 10
      const r = (await api(`/chats/${chatId}/messages?limit=200`)) as {
        messages: { speaker_id: string; kind: string; content: string }[]
      }
      for (const m of r.messages.slice(-n)) console.log(`[${m.speaker_id}] (${m.kind}) ${m.content}`)
      return
    }
    default:
      usage()
  }
}

main().catch(err => {
  console.error(`mnx error: ${err.message}`)
  process.exit(1)
})
