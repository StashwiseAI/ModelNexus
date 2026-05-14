import { loadEnv } from '../env.ts'
loadEnv()

import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { getOrCreateToken, requireToken } from './auth.ts'
import { ensureDirs } from './paths.ts'
import { getDb } from './db.ts'
import { appendMessage, fetchMessages } from './message-bus.ts'
import { createChat, getChat, listChats, addModelToChat } from './chat-store.ts'
import { recordCompletionSignal, forceDisband } from './completion.ts'
import { events } from './event-bus.ts'
import type { NexusEvent } from './event-bus.ts'

const PORT = parseInt(process.env.MODELNEXUS_PORT ?? '24000', 10)
const HOST = process.env.MODELNEXUS_HOST ?? '127.0.0.1'

const app = express()
app.use(express.json({ limit: '4mb' }))

const auth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === '/health') return next()
  if (!requireToken(req.headers.authorization)) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}
app.use(auth)

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '0.1.0' })
})

app.post('/chats', (req, res) => {
  const { task, models, template_id, system_prompt, min_duration_minutes } = req.body ?? {}
  if (typeof task !== 'string' || !Array.isArray(models) || models.length === 0) {
    res.status(400).json({ error: 'task and models[] required' })
    return
  }
  const chat = createChat({ task, models, template_id, system_prompt, min_duration_minutes })
  res.json({ chat })
})

app.get('/chats', (req, res) => {
  const status = typeof req.query.status === 'string' ? (req.query.status as 'active' | 'disbanded' | 'disbanding') : undefined
  res.json({ chats: listChats(status) })
})

app.get('/chats/:id', (req, res) => {
  const chat = getChat(req.params.id)
  if (!chat) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ chat })
})

app.post('/chats/:id/say', (req, res) => {
  const { speaker_id, kind, content, metadata } = req.body ?? {}
  if (!speaker_id || !content || !kind) {
    res.status(400).json({ error: 'speaker_id, kind, content required' })
    return
  }
  const chat = getChat(req.params.id)
  if (!chat) {
    res.status(404).json({ error: 'chat not found' })
    return
  }
  const msg = appendMessage({ chat_id: req.params.id, speaker_id, kind, content, metadata })
  res.json({ message: msg })
})

app.get('/chats/:id/messages', (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined
  res.json(fetchMessages({ chat_id: req.params.id, since_cursor: since, limit }))
})

app.post('/chats/:id/complete', (req, res) => {
  const { speaker_id } = req.body ?? {}
  if (!speaker_id) {
    res.status(400).json({ error: 'speaker_id required' })
    return
  }
  res.json(recordCompletionSignal(req.params.id, speaker_id))
})

app.post('/chats/:id/disband', (req, res) => {
  const ok = forceDisband(req.params.id, req.body?.reason ?? 'user')
  res.json({ disbanded: ok })
})

app.post('/chats/:id/invite', (req, res) => {
  const { model_id } = req.body ?? {}
  if (!model_id) {
    res.status(400).json({ error: 'model_id required' })
    return
  }
  try {
    addModelToChat(req.params.id, model_id)
    appendMessage({
      chat_id: req.params.id,
      speaker_id: 'system',
      kind: 'invite',
      content: `${model_id} joined the chat`,
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(404).json({ error: (err as Error).message })
  }
})

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://x')
  const chatId = url.searchParams.get('chat')
  const token = url.searchParams.get('token')
  if (token !== getOrCreateToken()) {
    ws.close(1008, 'unauthorized')
    return
  }
  if (!chatId) {
    ws.close(1008, 'chat query param required')
    return
  }
  const send = (e: NexusEvent): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e))
  }
  const off = events.subscribe(chatId, send)
  ws.on('close', () => off())
  ws.on('error', () => off())
})

export const start = (): void => {
  ensureDirs()
  getDb()
  const token = getOrCreateToken()
  httpServer.listen(PORT, HOST, () => {
    console.log(`modelnexus daemon listening on http://${HOST}:${PORT}`)
    console.log(`auth token (also at ~/.modelnexus/auth-token): ${token}`)
  })
}

const isEntry = (() => {
  try {
    const argv1 = process.argv[1] ?? ''
    return argv1.endsWith('server.ts') || argv1.endsWith('server.js')
  } catch {
    return false
  }
})()

if (isEntry) start()
