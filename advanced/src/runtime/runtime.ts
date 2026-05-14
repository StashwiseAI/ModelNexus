import type { CapabilityProfile } from '../types/capability.ts'
import type { NexusMessage } from '../types/message.ts'

export interface RuntimeContext {
  chat_id: string
  speaker_id: string
  profile: CapabilityProfile
  system_prompt: string
  task: string
}

export interface RuntimeTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: RuntimeContext) => Promise<string>
}

export interface ModelRuntime {
  readonly kind: 'api' | 'tmux' | 'subprocess'
  /** Start the participant. For tmux this spawns a session; for api this is a no-op. */
  start(ctx: RuntimeContext): Promise<void>
  /** Ask this participant to respond, given the current chat history. */
  prompt(ctx: RuntimeContext, history: NexusMessage[]): Promise<void>
  /** Tear down. */
  stop(ctx: RuntimeContext): Promise<void>
  /** Register the shared knowledge tools. Called once before start(). */
  registerTools(tools: RuntimeTool[]): void
}
