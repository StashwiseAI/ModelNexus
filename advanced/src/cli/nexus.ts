import { loadEnv } from '../env.ts'
loadEnv()

import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { getOrCreateToken } from '../daemon/auth.ts'
import type { TeamsFile, TeamTemplate } from '../types/chat.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..', '..')
const TEAMS_PATH = join(PKG_ROOT, 'teams.json')

const PORT = parseInt(process.env.MODELNEXUS_PORT ?? '24000', 10)
const HOST = process.env.MODELNEXUS_HOST ?? '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

const loadTeams = (): TeamsFile => JSON.parse(readFileSync(TEAMS_PATH, 'utf8')) as TeamsFile

const findTemplate = (id: string): TeamTemplate | undefined => loadTeams().templates.find(t => t.id === id)

interface FetchOpts {
  method?: string
  body?: unknown
}

const apiFetch = async (path: string, opts: FetchOpts = {}): Promise<unknown> => {
  const token = getOrCreateToken()
  const resp = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${text}`)
  return text ? JSON.parse(text) : null
}

const ensureDaemon = async (): Promise<void> => {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) })
    return
  } catch {
    /* not running */
  }
  console.log('starting daemon in background...')
  const child = spawn(
    process.execPath,
    [join(PKG_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(PKG_ROOT, 'src', 'daemon', 'server.ts')],
    { detached: true, stdio: 'ignore', cwd: PKG_ROOT, env: process.env }
  )
  child.unref()
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300))
    try {
      await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) })
      return
    } catch {
      /* keep polling */
    }
  }
  throw new Error('daemon failed to start')
}

const program = new Command()
program.name('nexus').description('ModelNexus — multi-model group chat').version('0.1.0')

program
  .command('daemon')
  .description('Start the daemon in the foreground')
  .action(async () => {
    await import('../daemon/server.ts').then(m => m.start())
  })

program
  .command('status')
  .description('Show daemon health and active chats')
  .action(async () => {
    try {
      const health = (await apiFetch('/health')) as { ok: boolean; version: string }
      const list = (await apiFetch('/chats?status=active')) as {
        chats: { id: string; task: string; created_at: number; models_json: string }[]
      }
      console.log(`daemon ok (${health.version})`)
      if (list.chats.length === 0) {
        console.log('no active chats')
        return
      }
      for (const c of list.chats) {
        const age = Math.round((Date.now() - c.created_at) / 1000)
        console.log(`  ${c.id}  [${age}s]  models=${c.models_json}  task=${c.task.slice(0, 60)}`)
      }
    } catch (err) {
      console.error(`daemon not running: ${(err as Error).message}`)
      console.error('start with:  nexus daemon')
      process.exitCode = 1
    }
  })

program
  .command('start <template>')
  .description('Start a chat from a team template (or use --models)')
  .option('-t, --task <task>', 'Task description', '')
  .option('-m, --models <ids>', 'Comma-separated model ids (overrides template)')
  .option('-d, --min-duration <minutes>', 'Min session duration in minutes', '10')
  .action(async (templateId: string, opts: { task: string; models?: string; minDuration: string }) => {
    await ensureDaemon()
    const tpl = findTemplate(templateId)
    if (!tpl) {
      console.error(`unknown template: ${templateId}`)
      process.exit(1)
    }
    const models = opts.models ? opts.models.split(',').map(s => s.trim()) : tpl.models
    const task = opts.task || `(${tpl.id}) ${tpl.description}`
    const min = parseInt(opts.minDuration, 10) || tpl.min_duration_minutes

    const created = (await apiFetch('/chats', {
      method: 'POST',
      body: {
        task,
        models,
        template_id: tpl.id,
        system_prompt: tpl.system_prompt,
        min_duration_minutes: min,
      },
    })) as { chat: { id: string } }
    const chatId = created.chat.id

    await apiFetch(`/chats/${chatId}/say`, {
      method: 'POST',
      body: { speaker_id: 'user', kind: 'user', content: task },
    })

    console.log(`chat ${chatId} started with: ${models.join(', ')}`)
    console.log(`run:  nexus chat ${chatId}        # interactive`)
    console.log(`run:  nexus monitor ${chatId}     # live view`)
  })

program
  .command('chat <chatId>')
  .description('Drive one or more turns of an existing chat')
  .option('-t, --turns <n>', 'Number of turns to run', '1')
  .action(async (chatId: string, opts: { turns: string }) => {
    await ensureDaemon()
    const orchestrator = await import('./orchestrator.ts')
    const turns = parseInt(opts.turns, 10) || 1
    for (let i = 0; i < turns; i++) {
      const r = await orchestrator.runOnce(chatId)
      console.log(`turn ${i + 1}: ${r.speaker} — ${r.reason}`)
    }
  })

program
  .command('say <chatId> <message...>')
  .description('Send a user message into the chat')
  .action(async (chatId: string, message: string[]) => {
    await ensureDaemon()
    const content = message.join(' ')
    await apiFetch(`/chats/${chatId}/say`, {
      method: 'POST',
      body: { speaker_id: 'user', kind: 'user', content },
    })
    console.log('sent')
  })

program
  .command('invite <chatId> <modelId>')
  .description('Invite an additional model into an active chat')
  .action(async (chatId: string, modelId: string) => {
    await ensureDaemon()
    const { inviteModel } = await import('../routing/invite.ts')
    inviteModel(chatId, modelId)
    console.log(`invited ${modelId} into ${chatId}`)
  })

program
  .command('disband <chatId>')
  .description('Force-end a chat')
  .action(async (chatId: string) => {
    await ensureDaemon()
    await apiFetch(`/chats/${chatId}/disband`, { method: 'POST', body: { reason: 'cli' } })
    const orchestrator = await import('./orchestrator.ts')
    await orchestrator.teardownChat(chatId)
    console.log(`disbanded ${chatId}`)
  })

program
  .command('monitor [chatId]')
  .description('Live TUI view of a chat')
  .action(async (chatId?: string) => {
    await ensureDaemon()
    if (!chatId) {
      const list = (await apiFetch('/chats?status=active')) as {
        chats: { id: string; created_at: number }[]
      }
      const latest = list.chats[0]
      if (!latest) {
        console.error('no active chats')
        process.exit(1)
      }
      chatId = latest.id
    }
    const { runMonitor } = await import('./monitor.ts')
    await runMonitor(chatId)
  })

program
  .command('models')
  .description('List declared model capabilities')
  .action(async () => {
    const { loadCapabilities } = await import('../runtime/index.ts')
    const caps = loadCapabilities()
    console.log('Moderator: ' + caps.moderator_model)
    for (const m of caps.models) {
      console.log(`  ${m.id}  [${m.runtime}/${m.cost_class}]  ${m.strengths.join(',')}`)
    }
  })

program
  .command('templates')
  .description('List team templates')
  .action(async () => {
    for (const t of loadTeams().templates) {
      console.log(`  ${t.id}  — ${t.description}`)
      console.log(`     models: ${t.models.join(', ')}`)
    }
  })

program
  .command('subs')
  .description('Detect which subscription-driven CLIs are installed and reachable')
  .action(async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    const candidates = [
      { id: 'claude-code-cli', cmd: 'claude', subscription: 'Claude Pro/Max' },
      { id: 'codex-cli', cmd: 'codex', subscription: 'ChatGPT Plus/Pro/Team or OpenAI API' },
      { id: 'gemini-cli', cmd: 'gemini', subscription: 'Google Gemini Advanced / Code Assist' },
    ]
    for (const c of candidates) {
      try {
        await run('which', [c.cmd], { timeout: 2000 })
        console.log(`  ✓ ${c.id.padEnd(20)} (\`${c.cmd}\` on PATH)   auth: ${c.subscription}`)
      } catch {
        console.log(`  ✗ ${c.id.padEnd(20)} not installed                auth: ${c.subscription}`)
      }
    }
    console.log('\nTo run a 3-CLI subscription chat with no API keys at all:')
    console.log('  nexus start subscription-brainstorm --task "<your task>"')
  })

program
  .command('env')
  .description('Show which provider API keys are loaded')
  .action(async () => {
    const { providerStatus } = await import('../env.ts')
    const s = providerStatus()
    console.log(`anthropic (Claude + moderator): ${s.anthropic ? 'loaded' : 'MISSING'}`)
    console.log(`openai (GPT + embeddings):      ${s.openai ? 'loaded' : 'MISSING'}`)
    console.log(`google (Gemini):                ${s.google ? 'loaded' : 'MISSING'}`)
    if (!s.anthropic && !s.openai && !s.google) {
      console.log('\nNo provider keys found. Copy .env.example to .env and fill in at least one.')
    }
  })

const isEntry = (() => {
  try {
    return (process.argv[1] ?? '').endsWith('nexus.ts') || (process.argv[1] ?? '').endsWith('nexus.js')
  } catch {
    return false
  }
})()

if (isEntry) {
  program.parseAsync(process.argv).catch(err => {
    console.error(err.message)
    process.exit(1)
  })
}

export { program }
