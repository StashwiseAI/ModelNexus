import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const DATA_ROOT = process.env.MODELNEXUS_DATA_DIR ?? join(homedir(), '.modelnexus')
export const DB_PATH = join(DATA_ROOT, 'nexus.db')
export const CHATS_DIR = join(DATA_ROOT, 'chats')
export const AUTH_PATH = join(DATA_ROOT, 'auth-token')

export const ensureDirs = (): void => {
  mkdirSync(DATA_ROOT, { recursive: true })
  mkdirSync(CHATS_DIR, { recursive: true })
}

export const chatDir = (chatId: string): string => {
  const dir = join(CHATS_DIR, chatId)
  mkdirSync(dir, { recursive: true })
  return dir
}
