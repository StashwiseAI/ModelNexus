import { randomUUID } from 'node:crypto'
import { getDb } from './db.ts'
import { events } from './event-bus.ts'
import type { AppendMessageInput, NexusMessage } from '../types/message.ts'

export const appendMessage = (input: AppendMessageInput): NexusMessage => {
  const db = getDb()
  const msg: NexusMessage = {
    id: randomUUID(),
    chat_id: input.chat_id,
    speaker_id: input.speaker_id,
    kind: input.kind,
    content: input.content,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: Date.now(),
  }
  db.prepare(
    `INSERT INTO messages (id, chat_id, speaker_id, kind, content, metadata_json, created_at)
     VALUES (@id, @chat_id, @speaker_id, @kind, @content, @metadata_json, @created_at)`
  ).run(msg)
  events.emitEvent(input.chat_id, { type: 'message', message: msg })
  return msg
}

export interface FetchOptions {
  chat_id: string
  since_cursor?: string
  limit?: number
}

export interface MessagePage {
  messages: NexusMessage[]
  next_cursor: string | null
}

export const fetchMessages = (opts: FetchOptions): MessagePage => {
  const db = getDb()
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000)
  const cursor = decodeCursor(opts.since_cursor)

  const rows = cursor
    ? db
        .prepare(
          `SELECT * FROM messages
           WHERE chat_id = ?
             AND (created_at, id) > (?, ?)
           ORDER BY created_at ASC, id ASC
           LIMIT ?`
        )
        .all(opts.chat_id, cursor.ts, cursor.id, limit)
    : db
        .prepare(
          `SELECT * FROM messages WHERE chat_id = ?
           ORDER BY created_at ASC, id ASC LIMIT ?`
        )
        .all(opts.chat_id, limit)

  const messages = rows as NexusMessage[]
  const last = messages[messages.length - 1]
  const next_cursor = last && messages.length === limit ? encodeCursor(last.created_at, last.id) : null
  return { messages, next_cursor }
}

const encodeCursor = (ts: number, id: string): string =>
  Buffer.from(`${ts}:${id}`).toString('base64url')

const decodeCursor = (c: string | undefined): { ts: number; id: string } | null => {
  if (!c) return null
  try {
    const [tsStr, id] = Buffer.from(c, 'base64url').toString('utf8').split(':')
    return { ts: parseInt(tsStr, 10), id }
  } catch {
    return null
  }
}
