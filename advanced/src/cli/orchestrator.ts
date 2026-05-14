import { fetchMessages } from '../daemon/message-bus.ts'
import { chatModels, getChat } from '../daemon/chat-store.ts'
import { pickSpeaker } from '../routing/moderator.ts'
import { getProfile, runtimeFor } from '../runtime/index.ts'
import { buildKnowledgeTools } from '../knowledge/tools.ts'
import { events } from '../daemon/event-bus.ts'
import type { ModelRuntime, RuntimeContext } from '../runtime/runtime.ts'

interface ActiveParticipant {
  runtime: ModelRuntime
  ctx: RuntimeContext
}

const sessions = new Map<string, Map<string, ActiveParticipant>>()

const ensureParticipant = async (
  chatId: string,
  modelId: string,
  systemPrompt: string,
  task: string
): Promise<ActiveParticipant> => {
  const perChat = sessions.get(chatId) ?? new Map<string, ActiveParticipant>()
  sessions.set(chatId, perChat)
  const existing = perChat.get(modelId)
  if (existing) return existing

  const profile = getProfile(modelId)
  const runtime = runtimeFor(profile)
  const tools = buildKnowledgeTools()
  runtime.registerTools(tools)
  const ctx: RuntimeContext = {
    chat_id: chatId,
    speaker_id: modelId,
    profile,
    system_prompt: systemPrompt,
    task,
  }
  await runtime.start(ctx)
  const p: ActiveParticipant = { runtime, ctx }
  perChat.set(modelId, p)
  return p
}

export const runOnce = async (chatId: string): Promise<{ speaker: string; reason: string }> => {
  const chat = getChat(chatId)
  if (!chat) throw new Error(`chat ${chatId} not found`)
  if (chat.status !== 'active') throw new Error(`chat is ${chat.status}`)

  const models = chatModels(chat)
  const history = fetchMessages({ chat_id: chatId, limit: 200 }).messages
  const last = history[history.length - 1]
  const exclude = last && models.includes(last.speaker_id) ? last.speaker_id : undefined

  const pick = await pickSpeaker(chatId, history, models, exclude)
  events.emitEvent(chatId, {
    type: 'speaker_picked',
    chat_id: chatId,
    speaker_id: pick.speaker_id,
    reason: pick.reason,
  })

  const p = await ensureParticipant(chatId, pick.speaker_id, chat.system_prompt ?? '', chat.task)
  await p.runtime.prompt(p.ctx, history)
  return { speaker: pick.speaker_id, reason: pick.reason }
}

export const teardownChat = async (chatId: string): Promise<void> => {
  const perChat = sessions.get(chatId)
  if (!perChat) return
  for (const [, p] of perChat) {
    try {
      await p.runtime.stop(p.ctx)
    } catch {
      /* ignore */
    }
  }
  sessions.delete(chatId)
}

export const activeParticipantIds = (chatId: string): string[] =>
  [...(sessions.get(chatId)?.keys() ?? [])]
