import Anthropic from '@anthropic-ai/sdk'
import { scoreProfiles, extractMention } from './capability.ts'
import { getProfile, loadCapabilities } from '../runtime/index.ts'
import type { NexusMessage } from '../types/message.ts'

export interface SpeakerPick {
  speaker_id: string
  reason: string
  source: 'mention' | 'capability' | 'llm' | 'round_robin'
}

const cache = new Map<string, { result: SpeakerPick; expires: number }>()
const CACHE_MS = 5000

export const pickSpeaker = async (
  chatId: string,
  history: NexusMessage[],
  candidateIds: string[],
  excludeSpeakerId?: string
): Promise<SpeakerPick> => {
  const cacheKey = `${chatId}:${history[history.length - 1]?.id ?? '_'}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.result

  const live = candidateIds.filter(id => id !== excludeSpeakerId)
  if (live.length === 0) {
    return { speaker_id: candidateIds[0], reason: 'only option', source: 'round_robin' }
  }

  const lastUser = [...history].reverse().find(m => m.kind === 'user' || m.kind === 'speaker')
  const text = lastUser?.content ?? ''

  const mentioned = extractMention(text, live)
  if (mentioned) {
    const pick: SpeakerPick = { speaker_id: mentioned, reason: '@-mention', source: 'mention' }
    cache.set(cacheKey, { result: pick, expires: Date.now() + CACHE_MS })
    return pick
  }

  const profiles = live.map(id => getProfile(id))
  const scored = scoreProfiles(profiles, text)
  const best = scored[0]
  if (best && best.score >= 1) {
    const pick: SpeakerPick = {
      speaker_id: best.profile.id,
      reason: `capability match: ${best.matched_tags.join(', ')}`,
      source: 'capability',
    }
    cache.set(cacheKey, { result: pick, expires: Date.now() + CACHE_MS })
    return pick
  }

  const llmPick = await pickViaLLM(history, live).catch(() => null)
  if (llmPick) {
    cache.set(cacheKey, { result: llmPick, expires: Date.now() + CACHE_MS })
    return llmPick
  }

  const count = history.reduce<Record<string, number>>((acc, m) => {
    if (live.includes(m.speaker_id)) acc[m.speaker_id] = (acc[m.speaker_id] ?? 0) + 1
    return acc
  }, {})
  const next = live.sort((a, b) => (count[a] ?? 0) - (count[b] ?? 0))[0]
  const pick: SpeakerPick = { speaker_id: next, reason: 'round robin', source: 'round_robin' }
  cache.set(cacheKey, { result: pick, expires: Date.now() + CACHE_MS })
  return pick
}

const pickViaLLM = async (history: NexusMessage[], live: string[]): Promise<SpeakerPick | null> => {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const caps = loadCapabilities()
  const moderatorModel = caps.moderator_model

  const profiles = live
    .map(id => getProfile(id))
    .map(p => `- ${p.id}: strengths=[${p.strengths.join(', ')}], cost=${p.cost_class}`)
    .join('\n')

  const recent = history.slice(-8).map(m => `[${m.speaker_id}]: ${m.content}`).join('\n')

  const client = new Anthropic()
  const resp = await client.messages.create({
    model: moderatorModel,
    max_tokens: 200,
    system: `You are the moderator of a multi-model group chat. Pick the single best next speaker based on the most recent question and each model's strengths. Reply with JSON: {"speaker_id": "...", "reason": "..."}. Pick only from the candidates.`,
    messages: [
      {
        role: 'user',
        content: `Candidates:\n${profiles}\n\nRecent transcript:\n${recent}\n\nWho should respond next?`,
      },
    ],
  })

  const text = resp.content
    .filter(c => c.type === 'text')
    .map(c => (c as { text: string }).text)
    .join('')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[0]) as { speaker_id?: string; reason?: string }
    if (parsed.speaker_id && live.includes(parsed.speaker_id)) {
      return { speaker_id: parsed.speaker_id, reason: parsed.reason ?? 'llm pick', source: 'llm' }
    }
  } catch {
    /* fall through */
  }
  return null
}
