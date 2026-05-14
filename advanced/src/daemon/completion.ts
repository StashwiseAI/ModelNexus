import { getDb } from './db.ts'
import { getChat, setChatStatus } from './chat-store.ts'
import { events } from './event-bus.ts'

const MIN_DISTINCT_SIGNALS = 2

export interface CompletionResult {
  accepted: boolean
  reason: string
  signals: number
  disbanded: boolean
}

export const recordCompletionSignal = (chatId: string, speakerId: string): CompletionResult => {
  const chat = getChat(chatId)
  if (!chat) return { accepted: false, reason: 'chat not found', signals: 0, disbanded: false }
  if (chat.status !== 'active')
    return { accepted: false, reason: `chat is ${chat.status}`, signals: 0, disbanded: chat.status === 'disbanded' }

  const db = getDb()
  db.prepare(
    `INSERT OR IGNORE INTO completion_signals (chat_id, speaker_id, created_at) VALUES (?, ?, ?)`
  ).run(chatId, speakerId, Date.now())

  const signals = (
    db.prepare(`SELECT COUNT(*) as n FROM completion_signals WHERE chat_id = ?`).get(chatId) as { n: number }
  ).n

  const ageMinutes = (Date.now() - chat.created_at) / 60_000
  if (signals >= MIN_DISTINCT_SIGNALS && ageMinutes >= chat.min_duration_minutes) {
    setChatStatus(chatId, 'disbanded')
    events.emitEvent(chatId, {
      type: 'chat_disbanded',
      chat_id: chatId,
      reason: `${signals} completion signals, ${ageMinutes.toFixed(1)}min elapsed`,
    })
    return { accepted: true, reason: 'disbanded', signals, disbanded: true }
  }

  const remaining =
    signals < MIN_DISTINCT_SIGNALS
      ? `awaiting ${MIN_DISTINCT_SIGNALS - signals} more signal(s)`
      : `awaiting min duration (${(chat.min_duration_minutes - ageMinutes).toFixed(1)}min remaining)`
  return { accepted: true, reason: remaining, signals, disbanded: false }
}

export const forceDisband = (chatId: string, reason = 'user'): boolean => {
  const chat = getChat(chatId)
  if (!chat || chat.status === 'disbanded') return false
  setChatStatus(chatId, 'disbanded')
  events.emitEvent(chatId, { type: 'chat_disbanded', chat_id: chatId, reason: `forced: ${reason}` })
  return true
}
