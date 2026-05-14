import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { AUTH_PATH, ensureDirs } from './paths.ts'

export const getOrCreateToken = (): string => {
  ensureDirs()
  if (existsSync(AUTH_PATH)) {
    return readFileSync(AUTH_PATH, 'utf8').trim()
  }
  const token = randomBytes(32).toString('hex')
  writeFileSync(AUTH_PATH, token, 'utf8')
  chmodSync(AUTH_PATH, 0o600)
  return token
}

export const requireToken = (header: string | undefined): boolean => {
  if (!header) return false
  const expected = getOrCreateToken()
  const provided = header.replace(/^Bearer\s+/i, '').trim()
  return provided === expected
}
