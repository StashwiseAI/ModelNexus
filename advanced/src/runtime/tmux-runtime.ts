import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendMessage } from '../daemon/message-bus.ts'
import type { ModelRuntime, RuntimeContext, RuntimeTool } from './runtime.ts'
import type { NexusMessage } from '../types/message.ts'

const run = promisify(execFile)

const sanitizeName = (name: string): string => {
  const s = name.replace(/[^a-zA-Z0-9\-_.]/g, '')
  if (!s) throw new Error(`invalid tmux name: ${name}`)
  return s
}

const tmuxHasSession = async (name: string): Promise<boolean> => {
  try {
    await run('tmux', ['has-session', '-t', sanitizeName(name)])
    return true
  } catch {
    return false
  }
}

const tmuxCreate = async (name: string, cwd: string): Promise<void> => {
  await run('tmux', ['new-session', '-d', '-s', sanitizeName(name), '-c', cwd])
}

const tmuxSetEnv = async (name: string, key: string, value: string): Promise<void> => {
  const sName = sanitizeName(name)
  const sKey = key.replace(/[^a-zA-Z0-9_]/g, '')
  await run('tmux', ['set-environment', '-t', sName, sKey, value])
}

const tmuxKill = async (name: string): Promise<void> => {
  try {
    await run('tmux', ['kill-session', '-t', sanitizeName(name)])
  } catch {
    /* gone already */
  }
}

const tmuxSendKeys = async (name: string, keys: string, opts: { enter?: boolean } = {}): Promise<void> => {
  const args = ['send-keys', '-t', sanitizeName(name), '-l', keys]
  await run('tmux', args)
  if (opts.enter) {
    await run('tmux', ['send-keys', '-t', sanitizeName(name), 'C-m'])
  }
}

const tmuxPasteFromFile = async (name: string, filePath: string): Promise<void> => {
  const sName = sanitizeName(name)
  const bufName = `mn-${sName}`
  await run('tmux', ['load-buffer', '-b', bufName, filePath])
  await run('tmux', ['paste-buffer', '-b', bufName, '-t', sName])
  await run('tmux', ['delete-buffer', '-b', bufName]).catch(() => {})
  await new Promise(r => setTimeout(r, 800))
  await run('tmux', ['send-keys', '-t', sName, 'Enter'])
  await new Promise(r => setTimeout(r, 300))
  await run('tmux', ['send-keys', '-t', sName, 'Enter'])
}

const tmuxCapture = async (name: string, lines = 2000): Promise<string> => {
  try {
    const sName = sanitizeName(name)
    const sLines = Math.max(1, Math.min(10000, Math.floor(lines)))
    const { stdout } = await run('tmux', ['capture-pane', '-t', sName, '-p', '-S', `-${sLines}`])
    return stdout
  } catch {
    return ''
  }
}

const waitForReady = async (name: string, marker: string, timeoutMs = 30_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pane = await tmuxCapture(name, 200)
    if (pane.includes(marker)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

const waitForIdle = async (
  name: string,
  opts: { idleMs?: number; maxMs?: number } = {}
): Promise<string> => {
  const idleMs = opts.idleMs ?? 4000
  const maxMs = opts.maxMs ?? 180_000
  const start = Date.now()
  let last = await tmuxCapture(name)
  let stableSince = Date.now()
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 1000))
    const now = await tmuxCapture(name)
    if (now === last) {
      if (Date.now() - stableSince >= idleMs) return now
    } else {
      last = now
      stableSince = Date.now()
    }
  }
  return last
}

const diffSince = (before: string, after: string): string => {
  if (!before) return after
  // Find the longest common prefix in line space; everything after is new.
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  let common = 0
  while (
    common < beforeLines.length &&
    common < afterLines.length &&
    beforeLines[common] === afterLines[common]
  ) {
    common++
  }
  return afterLines.slice(common).join('\n').trim()
}

const sessionFor = (ctx: RuntimeContext): string =>
  `mn-${ctx.chat_id.slice(0, 8)}-${ctx.profile.id}`.replace(/[^a-zA-Z0-9\-_.]/g, '-')

export class TmuxRuntime implements ModelRuntime {
  readonly kind = 'tmux' as const
  private tools: RuntimeTool[] = []
  private baseline = new Map<string, string>()

  registerTools(tools: RuntimeTool[]): void {
    // Tools are not directly callable by tmux CLIs — they shell out manually.
    // We still keep the registration so we can inject tool USAGE INSTRUCTIONS
    // into the system prompt.
    this.tools = tools
  }

  async start(ctx: RuntimeContext): Promise<void> {
    const session = sessionFor(ctx)
    if (await tmuxHasSession(session)) return

    const cmd = ctx.profile.command
    if (!cmd) throw new Error(`tmux profile ${ctx.profile.id} missing command`)

    await tmuxCreate(session, process.cwd())
    // Inject identifiers so `mnx` inside the session knows which chat to write to.
    await tmuxSetEnv(session, 'MODELNEXUS_CHAT_ID', ctx.chat_id)
    await tmuxSetEnv(session, 'MODELNEXUS_SPEAKER_ID', ctx.speaker_id)
    if (process.env.MODELNEXUS_PORT) {
      await tmuxSetEnv(session, 'MODELNEXUS_PORT', process.env.MODELNEXUS_PORT)
    }
    if (process.env.MODELNEXUS_HOST) {
      await tmuxSetEnv(session, 'MODELNEXUS_HOST', process.env.MODELNEXUS_HOST)
    }
    const flags = (ctx.profile.flags ?? []).join(' ')
    const launch = flags ? `${cmd} ${flags}` : cmd
    await tmuxSendKeys(session, launch, { enter: true })

    if (ctx.profile.ready_marker) {
      await waitForReady(session, ctx.profile.ready_marker)
    } else {
      await new Promise(r => setTimeout(r, 4000))
    }
    this.baseline.set(session, await tmuxCapture(session))

    // Send initial briefing — tells the CLI agent how to participate.
    const briefing = this.briefing(ctx)
    await this.send(ctx, session, briefing)
  }

  async prompt(ctx: RuntimeContext, history: NexusMessage[]): Promise<void> {
    const session = sessionFor(ctx)
    const recent = history
      .filter(m => m.speaker_id !== ctx.speaker_id)
      .slice(-6)
      .map(m => `[${m.speaker_id}]: ${m.content}`)
      .join('\n\n')
    const prompt = recent
      ? `New messages from peers:\n\n${recent}\n\nRespond as ${ctx.profile.id}. Be concise.`
      : `Task: ${ctx.task}\n\nRespond as ${ctx.profile.id}.`
    await this.send(ctx, session, prompt)
  }

  async stop(ctx: RuntimeContext): Promise<void> {
    await tmuxKill(sessionFor(ctx))
    this.baseline.delete(sessionFor(ctx))
  }

  private briefing(ctx: RuntimeContext): string {
    return `You are "${ctx.profile.id}" in a multi-model group chat.
Task: ${ctx.task}
Style: ${ctx.system_prompt}

Shared knowledge is on disk and reachable via the \`mnx\` shell helper. Whenever it would help, run these commands from your shell (do not paste them into chat output):

  mnx recall "<question>"           # look up what the team already decided/found
  mnx note decision "..."            # record a decision (kinds: decision|finding|hypothesis|question|todo)
  mnx say "<message to the group>"  # post a free-form message instead of a normal reply
  mnx complete                       # signal you think the task is done (needs >=2 agents agreeing)
  mnx peers                          # list other members
  mnx history 20                     # last 20 messages in the chat

Your normal text replies are automatically captured by the orchestrator — you don't need to call \`mnx say\` for those, only for asynchronous "thinking out loud" between turns. Always run \`mnx recall\` before reasoning from scratch about something the team might have already covered.

Reply concisely as ${ctx.profile.id}; one turn per response.`
  }

  private async send(ctx: RuntimeContext, session: string, text: string): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'mn-tmux-'))
    const file = join(dir, 'msg.txt')
    writeFileSync(file, text + '\n')

    const before = await tmuxCapture(session)
    if (ctx.profile.input_method === 'sendKeys') {
      await tmuxSendKeys(session, text, { enter: true })
    } else {
      await tmuxPasteFromFile(session, file)
    }

    const after = await waitForIdle(session, { idleMs: 4000, maxMs: 120_000 })
    const reply = diffSince(before, after)
    if (reply) {
      appendMessage({
        chat_id: ctx.chat_id,
        speaker_id: ctx.speaker_id,
        kind: 'speaker',
        content: reply,
      })
    }
  }
}
