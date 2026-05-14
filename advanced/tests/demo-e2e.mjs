// Live demo: spin up a daemon on a temp dir, create a 1-model chat with
// codex-cli, drive 1 turn, print the transcript.
//
// This bypasses the public CLI to keep the demo minimal and inspectable.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PKG_ROOT = new URL('..', import.meta.url).pathname
const PORT = 24500
const tmp = mkdtempSync(join(tmpdir(), 'mn-demo-'))

const log = (msg) => console.log(`\x1b[36m[demo]\x1b[0m ${msg}`)

const daemon = spawn(
  process.execPath,
  [join(PKG_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(PKG_ROOT, 'src', 'daemon', 'server.ts')],
  {
    env: { ...process.env, MODELNEXUS_DATA_DIR: tmp, MODELNEXUS_PORT: String(PORT), NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
)
daemon.stdout.on('data', (d) => process.stderr.write(`\x1b[90m[daemon] ${d}\x1b[0m`))
daemon.stderr.on('data', (d) => process.stderr.write(`\x1b[90m[daemon stderr] ${d}\x1b[0m`))

const waitFor = async (url) => {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300) })
      if (r.ok) return
    } catch { /* keep waiting */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('daemon never became healthy')
}

const cleanup = () => {
  daemon.kill('SIGKILL')
  rmSync(tmp, { recursive: true, force: true })
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

try {
  await waitFor(`http://127.0.0.1:${PORT}/health`)
  const token = readFileSync(join(tmp, 'auth-token'), 'utf8').trim()
  log(`daemon up on :${PORT}, token loaded`)

  const api = async (path, opts = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
    return r.json()
  }

  log('creating chat (codex-cli, no API key needed)...')
  const { chat } = await api('/chats', {
    method: 'POST',
    body: {
      task: 'tiny smoke test',
      models: ['codex-cli'],
      system_prompt: 'You are part of a group chat demo. Be terse — one sentence is plenty.',
      min_duration_minutes: 0,
    },
  })
  log(`chat id: ${chat.id}`)

  log('user posts a message...')
  await api(`/chats/${chat.id}/say`, {
    method: 'POST',
    body: {
      speaker_id: 'user',
      kind: 'user',
      content: 'Hi! In one short sentence, what is your favourite color and why? (this is a connection test — answer briefly)',
    },
  })

  log('running 1 orchestrator turn (this will spawn `codex exec`)...')
  process.env.MODELNEXUS_DATA_DIR = tmp
  process.env.MODELNEXUS_PORT = String(PORT)
  const { runOnce } = await import('../src/cli/orchestrator.ts')
  const t0 = Date.now()
  const turn = await runOnce(chat.id)
  log(`turn took ${((Date.now() - t0) / 1000).toFixed(1)}s — speaker=${turn.speaker}, reason=${turn.reason}`)

  log('fetching final transcript...')
  const { messages } = await api(`/chats/${chat.id}/messages`)
  console.log('\n\x1b[33m======= TRANSCRIPT =======\x1b[0m')
  for (const m of messages) {
    console.log(`\x1b[32m[${m.speaker_id}]\x1b[0m \x1b[90m(${m.kind})\x1b[0m`)
    console.log(m.content)
    console.log('---')
  }
  console.log('\x1b[33m=========================\x1b[0m\n')
} catch (err) {
  console.error(`\x1b[31m[demo error]\x1b[0m ${err.message}`)
  process.exitCode = 1
}

cleanup()
