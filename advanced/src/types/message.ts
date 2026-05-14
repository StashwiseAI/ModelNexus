export type MessageKind =
  | 'user'
  | 'speaker'
  | 'system'
  | 'tool_call'
  | 'tool_result'
  | 'note'
  | 'recall'
  | 'completion_signal'
  | 'invite'
  | 'catchup'

export interface NexusMessage {
  id: string
  chat_id: string
  speaker_id: string
  kind: MessageKind
  content: string
  metadata_json: string | null
  created_at: number
}

export interface AppendMessageInput {
  chat_id: string
  speaker_id: string
  kind: MessageKind
  content: string
  metadata?: Record<string, unknown>
}
