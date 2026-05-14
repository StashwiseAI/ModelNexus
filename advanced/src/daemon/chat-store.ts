import { randomUUID } from 'node:crypto'
import { getDb } from './db.ts'
import type { NexusChat, ChatStatus } from '../types/chat.ts'

export interface CreateChatInput {
  template_id?: string | null
  task: string
  models: string[]
  system_prompt?: string | null
  min_duration_minutes?: number
}

export const createChat = (input: CreateChatInput): NexusChat => {
  const db = getDb()
  const chat: NexusChat = {
    id: randomUUID(),
    template_id: input.template_id ?? null,
    task: input.task,
    status: 'active',
    models_json: JSON.stringify(input.models),
    system_prompt: input.system_prompt ?? null,
    min_duration_minutes: input.min_duration_minutes ?? 10,
    created_at: Date.now(),
    disbanded_at: null,
  }
  db.prepare(
    `INSERT INTO chats (id, template_id, task, status, models_json, system_prompt, min_duration_minutes, created_at, disbanded_at)
     VALUES (@id, @template_id, @task, @status, @models_json, @system_prompt, @min_duration_minutes, @created_at, @disbanded_at)`
  ).run(chat)
  return chat
}

export const getChat = (id: string): NexusChat | null => {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM chats WHERE id = ?`).get(id) as NexusChat | undefined
  return row ?? null
}

export const listChats = (status?: ChatStatus): NexusChat[] => {
  const db = getDb()
  return status
    ? (db.prepare(`SELECT * FROM chats WHERE status = ? ORDER BY created_at DESC`).all(status) as NexusChat[])
    : (db.prepare(`SELECT * FROM chats ORDER BY created_at DESC`).all() as NexusChat[])
}

export const setChatStatus = (id: string, status: ChatStatus): void => {
  const db = getDb()
  const disbanded_at = status === 'disbanded' ? Date.now() : null
  db.prepare(`UPDATE chats SET status = ?, disbanded_at = ? WHERE id = ?`).run(status, disbanded_at, id)
}

export const addModelToChat = (id: string, modelId: string): void => {
  const chat = getChat(id)
  if (!chat) throw new Error(`chat ${id} not found`)
  const models = new Set<string>(JSON.parse(chat.models_json))
  models.add(modelId)
  getDb().prepare(`UPDATE chats SET models_json = ? WHERE id = ?`).run(JSON.stringify([...models]), id)
}

export const chatModels = (chat: NexusChat): string[] => JSON.parse(chat.models_json) as string[]
