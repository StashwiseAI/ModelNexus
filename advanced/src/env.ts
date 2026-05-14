import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')

let _loaded = false

export const loadEnv = (): void => {
  if (_loaded) return
  _loaded = true

  const candidates = [
    join(process.cwd(), '.env'),
    join(PKG_ROOT, '.env'),
    process.env.MODELNEXUS_DATA_DIR ? join(process.env.MODELNEXUS_DATA_DIR, '.env') : null,
  ].filter((p): p is string => Boolean(p))

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, override: false })
    }
  }

  if (!process.env.GOOGLE_API_KEY && process.env.GEMINI_API_KEY) {
    process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY
  }
}

export const providerStatus = (): Record<string, boolean> => {
  loadEnv()
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    google: Boolean(process.env.GOOGLE_API_KEY),
  }
}
