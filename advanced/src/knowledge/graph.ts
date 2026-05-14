import { randomUUID } from 'node:crypto'
import { getDb } from '../daemon/db.ts'

export interface KgNode {
  id: string
  chat_id: string
  type: string
  label: string
  props_json: string | null
  created_at: number
}

export interface KgEdge {
  id: number
  chat_id: string
  src: string
  dst: string
  relation: string
  props_json: string | null
  created_at: number
}

const STOPWORDS = new Set([
  'The',
  'This',
  'That',
  'These',
  'Those',
  'When',
  'Where',
  'What',
  'Why',
  'How',
  'And',
  'But',
  'For',
  'With',
])

const extractEntities = (text: string): string[] => {
  const matches = text.match(/\b[A-Z][a-zA-Z0-9_\-]{2,}(?:\s+[A-Z][a-zA-Z0-9_\-]{2,})*\b/g) ?? []
  return Array.from(new Set(matches.filter(m => !STOPWORDS.has(m))))
}

export const upsertNodes = (chatId: string, content: string): KgNode[] => {
  const db = getDb()
  const labels = extractEntities(content)
  const out: KgNode[] = []
  const find = db.prepare(`SELECT * FROM kg_nodes WHERE chat_id = ? AND label = ? LIMIT 1`)
  const insert = db.prepare(
    `INSERT INTO kg_nodes (id, chat_id, type, label, props_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const label of labels) {
    const existing = find.get(chatId, label) as KgNode | undefined
    if (existing) {
      out.push(existing)
      continue
    }
    const node: KgNode = {
      id: randomUUID(),
      chat_id: chatId,
      type: 'entity',
      label,
      props_json: null,
      created_at: Date.now(),
    }
    insert.run(node.id, node.chat_id, node.type, node.label, node.props_json, node.created_at)
    out.push(node)
  }
  return out
}

export const linkCoOccurring = (
  chatId: string,
  nodes: KgNode[],
  relation = 'co_mentioned'
): void => {
  if (nodes.length < 2) return
  const insert = getDb().prepare(
    `INSERT INTO kg_edges (chat_id, src, dst, relation, props_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
  const now = Date.now()
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      insert.run(chatId, nodes[i].id, nodes[j].id, relation, null, now)
    }
  }
}

export const listNodes = (chatId: string): KgNode[] =>
  getDb().prepare(`SELECT * FROM kg_nodes WHERE chat_id = ?`).all(chatId) as KgNode[]

export const listEdges = (chatId: string): KgEdge[] =>
  getDb().prepare(`SELECT * FROM kg_edges WHERE chat_id = ?`).all(chatId) as KgEdge[]
