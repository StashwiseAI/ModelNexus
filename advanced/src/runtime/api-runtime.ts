import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { appendMessage } from '../daemon/message-bus.ts'
import type { ModelRuntime, RuntimeContext, RuntimeTool } from './runtime.ts'
import type { NexusMessage } from '../types/message.ts'

interface AnthropicToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

const MAX_TOOL_ROUNDS = 4

export class ApiRuntime implements ModelRuntime {
  readonly kind = 'api' as const
  private tools: RuntimeTool[] = []

  registerTools(tools: RuntimeTool[]): void {
    this.tools = tools
  }

  async start(_ctx: RuntimeContext): Promise<void> {
    /* no-op for API runtime */
  }

  async stop(_ctx: RuntimeContext): Promise<void> {
    /* no-op for API runtime */
  }

  async prompt(ctx: RuntimeContext, history: NexusMessage[]): Promise<void> {
    switch (ctx.profile.provider) {
      case 'anthropic':
        return this.promptAnthropic(ctx, history)
      case 'openai':
        return this.promptOpenAI(ctx, history)
      case 'google':
        return this.promptGoogle(ctx, history)
      default:
        throw new Error(`unknown provider for ${ctx.profile.id}`)
    }
  }

  // --- Anthropic --------------------------------------------------------

  private async promptAnthropic(ctx: RuntimeContext, history: NexusMessage[]): Promise<void> {
    const client = new Anthropic()
    const model = ctx.profile.api_model ?? ctx.profile.id
    const sysPrompt = `${ctx.system_prompt}\n\nYou are participating as "${ctx.profile.id}". Address peers by their id when relevant. Use the tools to share knowledge with the group.`

    type Msg = { role: 'user' | 'assistant'; content: unknown }
    const messages: Msg[] = transcriptToAnthropic(history, ctx.speaker_id)

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await client.messages.create({
        model,
        max_tokens: 2048,
        system: sysPrompt,
        tools: this.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
        messages: messages as Anthropic.MessageParam[],
      })

      const textParts = resp.content.filter(c => c.type === 'text') as { type: 'text'; text: string }[]
      const toolUses = resp.content.filter(c => c.type === 'tool_use') as AnthropicToolUse[]

      const text = textParts.map(t => t.text).join('').trim()
      if (text) {
        appendMessage({
          chat_id: ctx.chat_id,
          speaker_id: ctx.speaker_id,
          kind: 'speaker',
          content: text,
        })
      }

      if (toolUses.length === 0 || resp.stop_reason !== 'tool_use') return

      messages.push({ role: 'assistant', content: resp.content })
      const toolResults: unknown[] = []
      for (const use of toolUses) {
        const tool = this.tools.find(t => t.name === use.name)
        const result = tool
          ? await tool.handler(use.input, ctx).catch(err => `error: ${(err as Error).message}`)
          : `unknown tool ${use.name}`
        appendMessage({
          chat_id: ctx.chat_id,
          speaker_id: ctx.speaker_id,
          kind: 'tool_call',
          content: `${use.name}(${JSON.stringify(use.input)})`,
          metadata: { tool_use_id: use.id, result_preview: result.slice(0, 200) },
        })
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: result })
      }
      messages.push({ role: 'user', content: toolResults })
    }
  }

  // --- OpenAI -----------------------------------------------------------

  private async promptOpenAI(ctx: RuntimeContext, history: NexusMessage[]): Promise<void> {
    const client = new OpenAI()
    const model = ctx.profile.api_model ?? ctx.profile.id
    const sysPrompt = `${ctx.system_prompt}\n\nYou are participating as "${ctx.profile.id}". Address peers by their id when relevant. Use the tools to share knowledge with the group.`

    type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam
    const messages: ChatMsg[] = [
      { role: 'system', content: sysPrompt },
      ...transcriptToOpenAI(history, ctx.speaker_id),
    ]

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await client.chat.completions.create({
        model,
        messages,
        tools: this.tools.map(t => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      })

      const choice = resp.choices[0]
      const msg = choice.message
      if (msg.content) {
        appendMessage({
          chat_id: ctx.chat_id,
          speaker_id: ctx.speaker_id,
          kind: 'speaker',
          content: msg.content,
        })
      }
      const calls = msg.tool_calls ?? []
      if (calls.length === 0) return
      messages.push(msg as ChatMsg)
      for (const call of calls) {
        if (call.type !== 'function') continue
        const tool = this.tools.find(t => t.name === call.function.name)
        const args = safeJson(call.function.arguments)
        const result = tool
          ? await tool.handler(args, ctx).catch(err => `error: ${(err as Error).message}`)
          : `unknown tool ${call.function.name}`
        appendMessage({
          chat_id: ctx.chat_id,
          speaker_id: ctx.speaker_id,
          kind: 'tool_call',
          content: `${call.function.name}(${call.function.arguments})`,
          metadata: { tool_call_id: call.id, result_preview: result.slice(0, 200) },
        })
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }
  }

  // --- Google Gemini ---------------------------------------------------

  private async promptGoogle(ctx: RuntimeContext, history: NexusMessage[]): Promise<void> {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY required for Gemini')
    const client = new GoogleGenerativeAI(apiKey)
    const modelId = ctx.profile.api_model ?? ctx.profile.id
    const model = client.getGenerativeModel({
      model: modelId,
      systemInstruction: `${ctx.system_prompt}\n\nYou are "${ctx.profile.id}". Use tools to share findings with the group.`,
      tools: this.tools.length
        ? [
            {
              functionDeclarations: this.tools.map(t => ({
                name: t.name,
                description: t.description,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parameters: t.parameters as any,
              })),
            },
          ]
        : undefined,
    })
    const chat = model.startChat({ history: transcriptToGemini(history, ctx.speaker_id) })

    let prompt = lastUserBeforeMe(history, ctx.speaker_id) ?? ctx.task
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await chat.sendMessage(prompt)
      const resp = result.response
      const text = resp.text().trim()
      if (text) {
        appendMessage({
          chat_id: ctx.chat_id,
          speaker_id: ctx.speaker_id,
          kind: 'speaker',
          content: text,
        })
      }
      const calls = resp.functionCalls() ?? []
      if (calls.length === 0) return
      const responses: string[] = []
      for (const call of calls) {
        const tool = this.tools.find(t => t.name === call.name)
        const out = tool
          ? await tool.handler(call.args as Record<string, unknown>, ctx).catch(err => `error: ${(err as Error).message}`)
          : `unknown tool ${call.name}`
        appendMessage({
          chat_id: ctx.chat_id,
          speaker_id: ctx.speaker_id,
          kind: 'tool_call',
          content: `${call.name}(${JSON.stringify(call.args)})`,
          metadata: { result_preview: out.slice(0, 200) },
        })
        responses.push(out)
      }
      prompt = `tool results: ${responses.join('\n---\n')}`
    }
  }
}

// --- transcript adapters -----------------------------------------------

const transcriptToAnthropic = (
  history: NexusMessage[],
  me: string
): { role: 'user' | 'assistant'; content: string }[] => {
  return history
    .filter(m => m.kind === 'user' || m.kind === 'speaker' || m.kind === 'catchup' || m.kind === 'invite')
    .map(m => ({
      role: m.speaker_id === me ? ('assistant' as const) : ('user' as const),
      content: m.speaker_id === me ? m.content : `[${m.speaker_id}]: ${m.content}`,
    }))
}

const transcriptToOpenAI = (
  history: NexusMessage[],
  me: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
  return history
    .filter(m => m.kind === 'user' || m.kind === 'speaker' || m.kind === 'catchup' || m.kind === 'invite')
    .map(m =>
      m.speaker_id === me
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: `[${m.speaker_id}]: ${m.content}` }
    )
}

const transcriptToGemini = (
  history: NexusMessage[],
  me: string
): { role: 'user' | 'model'; parts: { text: string }[] }[] => {
  return history
    .filter(m => m.kind === 'user' || m.kind === 'speaker' || m.kind === 'catchup' || m.kind === 'invite')
    .map(m => ({
      role: m.speaker_id === me ? ('model' as const) : ('user' as const),
      parts: [{ text: m.speaker_id === me ? m.content : `[${m.speaker_id}]: ${m.content}` }],
    }))
}

const lastUserBeforeMe = (history: NexusMessage[], me: string): string | null => {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.speaker_id !== me && (m.kind === 'user' || m.kind === 'speaker')) {
      return `[${m.speaker_id}]: ${m.content}`
    }
  }
  return null
}

const safeJson = (s: string): Record<string, unknown> => {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}
