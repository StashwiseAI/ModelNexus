import { EventEmitter } from 'node:events'
import type { NexusMessage } from '../types/message.ts'

export type NexusEvent =
  | { type: 'message'; message: NexusMessage }
  | { type: 'chat_disbanded'; chat_id: string; reason: string }
  | { type: 'speaker_picked'; chat_id: string; speaker_id: string; reason: string }

class NexusEventBus extends EventEmitter {
  emitEvent(chatId: string, event: NexusEvent): void {
    this.emit(`chat:${chatId}`, event)
    this.emit('all', event)
  }

  subscribe(chatId: string, fn: (e: NexusEvent) => void): () => void {
    this.on(`chat:${chatId}`, fn)
    return () => this.off(`chat:${chatId}`, fn)
  }
}

export const events = new NexusEventBus()
events.setMaxListeners(200)
