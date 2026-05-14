import type { CapabilityProfile, StrengthTag } from '../types/capability.ts'

const TAG_KEYWORDS: Record<StrengthTag, string[]> = {
  reasoning: ['why', 'because', 'argue', 'analyze', 'reason', 'logic', 'tradeoff'],
  coding: ['code', 'function', 'class', 'refactor', 'implement', 'bug', 'compile', 'typescript', 'python'],
  vision: ['image', 'picture', 'screenshot', 'diagram', 'visual'],
  'long-context': ['long', 'whole file', 'entire', 'codebase', 'monorepo'],
  web: ['url', 'http', 'fetch', 'website', 'docs'],
  'web-context': ['search', 'browse', 'recent', 'news'],
  math: ['equation', 'derive', 'proof', 'formula', 'calculate', 'numerical'],
  writing: ['draft', 'write', 'prose', 'documentation', 'readme'],
  synthesis: ['summarize', 'distill', 'merge', 'reconcile'],
  refactor: ['refactor', 'clean up', 'simplify'],
  execution: ['run', 'execute', 'shell', 'cli'],
  'tool-use': ['tool', 'mcp', 'function call'],
  filesystem: ['file', 'directory', 'read', 'write file', 'edit'],
  agentic: ['agent', 'autonomous', 'plan'],
  fast: ['quick', 'cheap', 'tiny'],
  moderator: [],
  routing: [],
  balanced: [],
  multilingual: ['translate', 'language'],
  git: ['commit', 'branch', 'merge', 'diff', 'pr ', 'pull request'],
}

const COST_PENALTY: Record<CapabilityProfile['cost_class'], number> = {
  low: 0,
  med: 0.05,
  high: 0.1,
}

export interface ScoredProfile {
  profile: CapabilityProfile
  score: number
  matched_tags: StrengthTag[]
}

export const scoreProfiles = (
  profiles: CapabilityProfile[],
  question: string
): ScoredProfile[] => {
  const lower = question.toLowerCase()
  return profiles
    .map(profile => {
      let score = 0
      const matched: StrengthTag[] = []
      for (const tag of profile.strengths) {
        const kws = TAG_KEYWORDS[tag] ?? []
        const hit = kws.some(k => lower.includes(k))
        if (hit) {
          score += 1
          matched.push(tag)
        }
      }
      score -= COST_PENALTY[profile.cost_class]
      return { profile, score, matched_tags: matched }
    })
    .sort((a, b) => b.score - a.score)
}

export const extractMention = (text: string, candidates: string[]): string | null => {
  const match = text.match(/@([a-zA-Z0-9_\-.]+)/g)
  if (!match) return null
  for (const m of match) {
    const id = m.slice(1)
    if (candidates.includes(id)) return id
    const partial = candidates.find(c => c.includes(id))
    if (partial) return partial
  }
  return null
}
