import blessed from 'blessed'
import WebSocket from 'ws'
import { getOrCreateToken } from '../daemon/auth.ts'
import { getProfile, loadCapabilities } from '../runtime/index.ts'
import type { NexusMessage } from '../types/message.ts'

const PORT = parseInt(process.env.MODELNEXUS_PORT ?? '24000', 10)
const HOST = process.env.MODELNEXUS_HOST ?? '127.0.0.1'

const COLORS = ['green', 'cyan', 'yellow', 'magenta', 'blue', 'red', 'white']
const colorFor = (speakerId: string, idx: number): string => {
  try {
    return getProfile(speakerId).color ?? COLORS[idx % COLORS.length]
  } catch {
    return COLORS[idx % COLORS.length]
  }
}

export const runMonitor = async (chatId: string): Promise<void> => {
  const token = getOrCreateToken()
  loadCapabilities()

  const screen = blessed.screen({ smartCSR: true, title: `nexus ${chatId.slice(0, 8)}` })

  const header = blessed.text({
    parent: screen,
    top: 0,
    left: 0,
    height: 1,
    width: '100%',
    content: ` ModelNexus  chat ${chatId}   (q to quit) `,
    style: { fg: 'white', bg: 'blue' },
  })

  const log = blessed.log({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    bottom: 1,
    border: 'line',
    label: ' transcript ',
    scrollbar: { ch: ' ', style: { bg: 'grey' } },
    keys: true,
    mouse: true,
    tags: true,
  })

  const footer = blessed.text({
    parent: screen,
    bottom: 0,
    left: 0,
    height: 1,
    width: '100%',
    content: ' connecting... ',
    style: { fg: 'white', bg: 'black' },
  })

  screen.key(['q', 'C-c'], () => process.exit(0))

  const seenIds = new Set<string>()
  let speakerIdx: Record<string, number> = {}
  let nextIdx = 0

  const render = (m: NexusMessage): void => {
    if (seenIds.has(m.id)) return
    seenIds.add(m.id)
    if (!(m.speaker_id in speakerIdx)) speakerIdx[m.speaker_id] = nextIdx++
    const color = colorFor(m.speaker_id, speakerIdx[m.speaker_id])
    const ts = new Date(m.created_at).toISOString().slice(11, 19)
    const tag = `{${color}-fg}{bold}[${m.speaker_id}]{/bold}{/${color}-fg}`
    log.log(`{grey-fg}${ts}{/grey-fg} ${tag} {grey-fg}(${m.kind}){/grey-fg}`)
    log.log(m.content)
    log.log('')
  }

  try {
    const resp = await fetch(`http://${HOST}:${PORT}/chats/${chatId}/messages?limit=500`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (resp.ok) {
      const data = (await resp.json()) as { messages: NexusMessage[] }
      for (const m of data.messages) render(m)
    }
  } catch (err) {
    log.log(`{red-fg}failed to load history: ${(err as Error).message}{/red-fg}`)
  }

  const ws = new WebSocket(`ws://${HOST}:${PORT}/ws?chat=${chatId}&token=${token}`)
  ws.on('open', () => {
    footer.setContent(' connected — live ')
    screen.render()
  })
  ws.on('message', raw => {
    try {
      const evt = JSON.parse(raw.toString()) as
        | { type: 'message'; message: NexusMessage }
        | { type: 'chat_disbanded'; reason: string }
        | { type: 'speaker_picked'; speaker_id: string; reason: string }
      if (evt.type === 'message') render(evt.message)
      else if (evt.type === 'chat_disbanded') {
        log.log(`{red-fg}chat disbanded: ${evt.reason}{/red-fg}`)
      } else if (evt.type === 'speaker_picked') {
        footer.setContent(` next speaker: ${evt.speaker_id} (${evt.reason}) `)
      }
      screen.render()
    } catch {
      /* ignore */
    }
  })
  ws.on('close', () => {
    footer.setContent(' disconnected ')
    screen.render()
  })

  screen.render()
}
