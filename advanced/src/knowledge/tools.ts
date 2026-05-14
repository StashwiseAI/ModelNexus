import { appendLedgerEntry } from './ledger.ts'
import { upsertVecEntry, searchVec } from './vector.ts'
import { upsertNodes, linkCoOccurring, listNodes } from './graph.ts'
import { appendMessage } from '../daemon/message-bus.ts'
import type { RuntimeTool, RuntimeContext } from '../runtime/runtime.ts'

const NOTE_KINDS = ['decision', 'finding', 'hypothesis', 'question', 'todo'] as const

export const buildKnowledgeTools = (): RuntimeTool[] => {
  const nexus_note: RuntimeTool = {
    name: 'nexus_note',
    description:
      'Record a finding, decision, hypothesis, question, or todo for the rest of the group. Other models can later retrieve it via nexus_recall.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...NOTE_KINDS],
          description: 'What sort of note this is.',
        },
        content: {
          type: 'string',
          description: 'The note body. Be concise and actionable.',
        },
      },
      required: ['kind', 'content'],
    },
    handler: async (args, ctx: RuntimeContext) => {
      const kind = String(args.kind ?? 'finding')
      const content = String(args.content ?? '').trim()
      if (!content) return 'error: content required'
      appendLedgerEntry(ctx.chat_id, ctx.speaker_id, kind, content)
      await upsertVecEntry(ctx.chat_id, kind, `[${kind}] ${content}`)
      const nodes = upsertNodes(ctx.chat_id, content)
      linkCoOccurring(ctx.chat_id, nodes, `co_${kind}`)
      appendMessage({
        chat_id: ctx.chat_id,
        speaker_id: ctx.speaker_id,
        kind: 'note',
        content,
        metadata: { kind, entities: nodes.map(n => n.label) },
      })
      return `noted (${kind}). entities indexed: ${nodes.map(n => n.label).join(', ') || 'none'}`
    },
  }

  const nexus_recall: RuntimeTool = {
    name: 'nexus_recall',
    description:
      "Search the team's shared knowledge (ledger + vector store + graph). Use this BEFORE answering questions about what the team already decided or discovered.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question or topic to look up.' },
        k: { type: 'integer', description: 'Max results (default 5).', default: 5 },
      },
      required: ['query'],
    },
    handler: async (args, ctx: RuntimeContext) => {
      const query = String(args.query ?? '').trim()
      const k = typeof args.k === 'number' ? Math.min(Math.max(args.k, 1), 20) : 5
      if (!query) return 'error: query required'

      const hits = await searchVec(ctx.chat_id, query, k)
      const nodes = listNodes(ctx.chat_id).filter(n =>
        query.toLowerCase().includes(n.label.toLowerCase())
      )
      appendMessage({
        chat_id: ctx.chat_id,
        speaker_id: ctx.speaker_id,
        kind: 'recall',
        content: query,
        metadata: { hits: hits.length, entities: nodes.map(n => n.label) },
      })

      if (hits.length === 0 && nodes.length === 0) return 'no relevant prior notes found'
      const lines: string[] = []
      if (hits.length) {
        lines.push('# Relevant prior notes')
        for (const h of hits) lines.push(`- (${h.kind}) ${h.content}`)
      }
      if (nodes.length) {
        lines.push('\n# Known entities')
        for (const n of nodes) lines.push(`- ${n.label}`)
      }
      return lines.join('\n')
    },
  }

  return [nexus_note, nexus_recall]
}
