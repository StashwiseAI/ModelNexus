import { appendMessage, fetchMessages } from '../daemon/message-bus.ts'
import { addModelToChat, getChat } from '../daemon/chat-store.ts'
import { ensureLedger } from '../knowledge/ledger.ts'
import { readFileSync } from 'node:fs'

const CATCHUP_TAIL = 12

export const inviteModel = (chatId: string, modelId: string): void => {
  const chat = getChat(chatId)
  if (!chat) throw new Error(`chat ${chatId} not found`)
  if (chat.status !== 'active') throw new Error(`chat is ${chat.status}`)

  addModelToChat(chatId, modelId)

  const recent = fetchMessages({ chat_id: chatId, limit: 200 }).messages.slice(-CATCHUP_TAIL)
  const transcript = recent
    .map(m => `[${m.speaker_id}] (${m.kind}): ${m.content}`)
    .join('\n')

  let ledger = ''
  try {
    ledger = readFileSync(ensureLedger(chatId), 'utf8')
  } catch {
    /* no ledger yet */
  }

  const catchup = `# Mid-chat catch-up for ${modelId}

You are joining an ongoing group chat. The task: ${chat.task}

Recent messages:
${transcript || '(no recent messages)'}

Shared ledger so far:
${ledger || '(empty)'}

Introduce yourself briefly and pick up the conversation. Use nexus_recall for context you need beyond the above. Use nexus_note for anything new you learn.`

  appendMessage({
    chat_id: chatId,
    speaker_id: 'system',
    kind: 'invite',
    content: `${modelId} joined the chat`,
    metadata: { invited: modelId },
  })
  appendMessage({
    chat_id: chatId,
    speaker_id: modelId,
    kind: 'catchup',
    content: catchup,
  })
}
