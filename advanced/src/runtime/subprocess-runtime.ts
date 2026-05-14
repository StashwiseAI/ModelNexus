// SubprocessRuntime — one-shot invocation of a CLI binary per turn.
//
// Each prompt() call spawns a fresh subprocess with the conversation context
// piped via stdin (or passed as an argv), captures stdout as the reply, and
// exits. This is the right path for subscription-driven CLIs (claude -p,
// codex exec, gemini -p) because:
//
//  - No persistent tmux session to manage, no fragile idle detection.
//  - Each call uses the CLI's own subscription auth (Claude Pro/Max OAuth,
//    ChatGPT-login OAuth, Google login) — exactly the same auth as
//    interactive use.
//  - The conversation memory lives in the daemon's SQLite, not in the CLI
//    process — so we don't need the CLI to "remember" anything between turns.
//
// Tradeoffs vs TmuxRuntime:
//  - Each turn pays the CLI's cold-start cost (claude -p is ~1-3s of overhead).
//  - The CLI can't use its own tools across turns (no persistent agentic state)
//    — but `mnx` (via the injected env vars) gives it the shared knowledge
//    graph regardless.

import { spawn } from 'node:child_process'
import { appendMessage } from '../daemon/message-bus.ts'
import type { ModelRuntime, RuntimeContext, RuntimeTool } from './runtime.ts'
import type { NexusMessage } from '../types/message.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TRANSCRIPT = 16

export class SubprocessRuntime implements ModelRuntime {
  readonly kind = 'subprocess' as const
  private tools: RuntimeTool[] = []

  registerTools(tools: RuntimeTool[]): void {
    this.tools = tools
  }

  async start(_ctx: RuntimeContext): Promise<void> {
    /* no-op — each turn spawns its own process */
  }

  async stop(_ctx: RuntimeContext): Promise<void> {
    /* no-op */
  }

  async prompt(ctx: RuntimeContext, history: NexusMessage[]): Promise<void> {
    const profile = ctx.profile
    if (!profile.command) throw new Error(`subprocess profile ${profile.id} missing command`)

    const fullPrompt = this.buildPrompt(ctx, history)
    const args = profile.args_template ? [...profile.args_template] : []
    const promptVia = profile.prompt_via ?? 'stdin'
    const timeout = profile.timeout_ms ?? DEFAULT_TIMEOUT_MS

    if (promptVia === 'arg') args.push(fullPrompt)

    const child = spawn(profile.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MODELNEXUS_CHAT_ID: ctx.chat_id,
        MODELNEXUS_SPEAKER_ID: ctx.speaker_id,
      },
    })

    let stdout = ''
    let stderr = ''
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeout)

    child.stdout.on('data', d => {
      stdout += d.toString()
    })
    child.stderr.on('data', d => {
      stderr += d.toString()
    })

    if (promptVia === 'stdin') {
      child.stdin.write(fullPrompt)
      child.stdin.end()
    } else {
      child.stdin.end()
    }

    const code: number = await new Promise(resolve => {
      child.on('close', c => {
        clearTimeout(timer)
        resolve(c ?? -1)
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(-1)
      })
    })

    const reply = extractReply(stdout, profile.output_marker_start, profile.output_marker_end).trim()
    if (killed) {
      appendMessage({
        chat_id: ctx.chat_id,
        speaker_id: ctx.speaker_id,
        kind: 'system',
        content: `(${profile.id} timed out after ${timeout}ms)`,
      })
      return
    }
    if (code !== 0 && !reply) {
      appendMessage({
        chat_id: ctx.chat_id,
        speaker_id: ctx.speaker_id,
        kind: 'system',
        content: `(${profile.id} exited ${code}: ${stderr.slice(0, 400).trim() || 'no stderr'})`,
      })
      return
    }
    if (!reply) {
      appendMessage({
        chat_id: ctx.chat_id,
        speaker_id: ctx.speaker_id,
        kind: 'system',
        content: `(${profile.id} produced no output)`,
      })
      return
    }
    appendMessage({
      chat_id: ctx.chat_id,
      speaker_id: ctx.speaker_id,
      kind: 'speaker',
      content: reply,
    })
  }

  private buildPrompt(ctx: RuntimeContext, history: NexusMessage[]): string {
    const peers = history
      .map(m => m.speaker_id)
      .filter((id, i, a) => id !== ctx.speaker_id && a.indexOf(id) === i)
    const recent = history
      .filter(m => m.kind === 'user' || m.kind === 'speaker' || m.kind === 'note' || m.kind === 'invite')
      .slice(-MAX_TRANSCRIPT)
      .map(m => `[${m.speaker_id}${m.speaker_id === ctx.speaker_id ? ' (you)' : ''}]: ${m.content}`)
      .join('\n')

    const toolNote = this.tools.length
      ? `\nIf useful, you can also call the shared knowledge graph via the \`mnx\` shell helper in your shell (mnx recall "...", mnx note decision "...", mnx complete). But for THIS prompt just return your reply as plain text — your reply is automatically appended to the chat.`
      : ''

    return `You are "${ctx.profile.id}" participating in a multi-model group chat.
Task: ${ctx.task}
Style: ${ctx.system_prompt}
Peers in the chat: ${peers.join(', ') || '(none yet)'}
${toolNote}

Recent transcript:
${recent || '(no messages yet — this is the opening turn)'}

Reply concisely as ${ctx.profile.id} — one or two short paragraphs at most. Do not prefix with your name. Do not narrate that you are responding. Just say the thing.`
  }
}

const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g
const cleanOutput = (s: string): string => s.replace(ANSI_PATTERN, '').trim()

export const extractReply = (raw: string, startMarker?: string, endMarker?: string): string => {
  const cleaned = cleanOutput(raw)
  if (!startMarker) return cleaned
  const startIdx = cleaned.indexOf(startMarker)
  if (startIdx === -1) return cleaned
  const after = cleaned.slice(startIdx + startMarker.length)
  if (!endMarker) return after
  const endIdx = after.indexOf(endMarker)
  return endIdx === -1 ? after : after.slice(0, endIdx)
}
