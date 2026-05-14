import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatDir } from '../daemon/paths.ts'

const HEADER = `# ModelNexus Chat Ledger

This file is the append-only journal of decisions, findings, hypotheses, and questions captured by every participating model.

`

const SECTION_HEADINGS: Record<string, string> = {
  decision: '## Decisions',
  finding: '## Findings',
  hypothesis: '## Hypotheses',
  question: '## Open Questions',
  todo: '## TODO',
}

export const ledgerPath = (chatId: string): string => join(chatDir(chatId), 'ledger.md')

export const ensureLedger = (chatId: string): string => {
  const p = ledgerPath(chatId)
  if (!existsSync(p)) writeFileSync(p, HEADER, 'utf8')
  return p
}

export const appendLedgerEntry = (
  chatId: string,
  speakerId: string,
  kind: string,
  content: string
): void => {
  const p = ensureLedger(chatId)
  const ts = new Date().toISOString()
  const heading = SECTION_HEADINGS[kind] ?? `## ${kind}`
  const block = `\n${heading}\n- **${ts}** _(${speakerId})_ — ${content.trim()}\n`
  appendFileSync(p, block, 'utf8')
}
