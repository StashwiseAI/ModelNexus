import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')

const tmp = mkdtempSync(join(tmpdir(), 'mn-daemon-'))
const PORT = 24000 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`

let daemon: ChildProcess
let token: string

const waitFor = async (url: string, ms = 5000): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300) })
      if (r.ok) return true
    } catch {
      /* keep waiting */
    }
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

beforeAll(async () => {
  daemon = spawn(
    process.execPath,
    [join(PKG_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(PKG_ROOT, 'src', 'daemon', 'server.ts')],
    {
      env: {
        ...process.env,
        MODELNEXUS_DATA_DIR: tmp,
        MODELNEXUS_PORT: String(PORT),
        NODE_NO_WARNINGS: '1',
      },
      stdio: 'pipe',
    }
  )
  const ok = await waitFor(`${BASE}/health`)
  if (!ok) throw new Error('daemon did not start in time')
  const { getOrCreateToken } = await import('../src/daemon/auth.ts')
  // The daemon-side token lives in $tmp/auth-token; we read the same path.
  const fs = await import('node:fs')
  token = fs.readFileSync(join(tmp, 'auth-token'), 'utf8').trim()
  void getOrCreateToken
})

afterAll(() => {
  daemon.kill('SIGKILL')
  rmSync(tmp, { recursive: true, force: true })
})

const api = async (path: string, opts: { method?: string; body?: unknown } = {}): Promise<unknown> => {
  const r = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

describe('daemon http api', () => {
  it('requires auth', async () => {
    const r = await fetch(`${BASE}/chats`)
    expect(r.status).toBe(401)
  })

  it('creates, says, fetches, completes', async () => {
    const created = (await api('/chats', {
      method: 'POST',
      body: { task: 'integration', models: ['claude-opus-4-7', 'gpt-5'], min_duration_minutes: 0 },
    })) as { chat: { id: string } }
    const id = created.chat.id

    await api(`/chats/${id}/say`, {
      method: 'POST',
      body: { speaker_id: 'user', kind: 'user', content: 'hello team' },
    })

    const msgs = (await api(`/chats/${id}/messages`)) as { messages: { content: string }[] }
    expect(msgs.messages.length).toBe(1)
    expect(msgs.messages[0].content).toBe('hello team')

    const c1 = (await api(`/chats/${id}/complete`, {
      method: 'POST',
      body: { speaker_id: 'claude-opus-4-7' },
    })) as { disbanded: boolean }
    expect(c1.disbanded).toBe(false)

    const c2 = (await api(`/chats/${id}/complete`, {
      method: 'POST',
      body: { speaker_id: 'gpt-5' },
    })) as { disbanded: boolean }
    expect(c2.disbanded).toBe(true)
  })
})
