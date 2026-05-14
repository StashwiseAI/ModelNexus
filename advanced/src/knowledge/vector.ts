import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { getDb } from '../daemon/db.ts'

const EMBED_MODEL = 'text-embedding-3-small'

let _embedClient: OpenAI | null = null
let _embedDisabled = false

const embedClient = (): OpenAI | null => {
  if (_embedDisabled) return null
  if (_embedClient) return _embedClient
  if (!process.env.OPENAI_API_KEY) {
    _embedDisabled = true
    return null
  }
  _embedClient = new OpenAI()
  return _embedClient
}

export const embed = async (text: string): Promise<Float32Array | null> => {
  const client = embedClient()
  if (!client) return null
  try {
    const resp = await client.embeddings.create({ model: EMBED_MODEL, input: text })
    return new Float32Array(resp.data[0].embedding)
  } catch {
    _embedDisabled = true
    return null
  }
}

const toBlob = (vec: Float32Array): Buffer => Buffer.from(vec.buffer)
const fromBlob = (buf: Buffer | null): Float32Array | null =>
  buf && buf.byteLength ? new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) : null

const cosine = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export interface VecEntry {
  id: string
  chat_id: string
  kind: string
  content: string
  embedding: Buffer | null
  created_at: number
}

export const upsertVecEntry = async (
  chatId: string,
  kind: string,
  content: string
): Promise<void> => {
  const id = randomUUID()
  const vec = await embed(content)
  getDb()
    .prepare(
      `INSERT INTO vec_entries (id, chat_id, kind, content, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, chatId, kind, content, vec ? toBlob(vec) : null, Date.now())
}

export const searchVec = async (
  chatId: string,
  query: string,
  k: number
): Promise<VecEntry[]> => {
  const rows = getDb()
    .prepare(`SELECT * FROM vec_entries WHERE chat_id = ? ORDER BY created_at DESC LIMIT 500`)
    .all(chatId) as VecEntry[]
  if (rows.length === 0) return []

  const qVec = await embed(query)
  if (qVec) {
    const scored = rows
      .map(r => {
        const v = fromBlob(r.embedding)
        return { row: r, score: v ? cosine(qVec, v) : -1 }
      })
      .filter(s => s.score >= 0)
      .sort((a, b) => b.score - a.score)
    if (scored.length) return scored.slice(0, k).map(s => s.row)
  }

  // Fallback: keyword overlap.
  const tokens = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3)
  )
  const scored = rows
    .map(r => {
      const text = r.content.toLowerCase()
      let hits = 0
      for (const t of tokens) if (text.includes(t)) hits++
      return { row: r, score: hits }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map(s => s.row)
}
