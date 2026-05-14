import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { ApiRuntime } from './api-runtime.ts'
import { TmuxRuntime } from './tmux-runtime.ts'
import { SubprocessRuntime } from './subprocess-runtime.ts'
import type { ModelRuntime } from './runtime.ts'
import type { CapabilitiesFile, CapabilityProfile } from '../types/capability.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CAPS_PATH = join(__dirname, '..', '..', 'capabilities.json')

let _caps: CapabilitiesFile | null = null

export const loadCapabilities = (): CapabilitiesFile => {
  if (_caps) return _caps
  const raw = readFileSync(CAPS_PATH, 'utf8')
  _caps = JSON.parse(raw) as CapabilitiesFile
  return _caps
}

export const getProfile = (modelId: string): CapabilityProfile => {
  const caps = loadCapabilities()
  const p = caps.models.find(m => m.id === modelId)
  if (!p) throw new Error(`unknown model: ${modelId}`)
  return p
}

export const runtimeFor = (profile: CapabilityProfile): ModelRuntime => {
  switch (profile.runtime) {
    case 'api':
      return new ApiRuntime()
    case 'tmux':
      return new TmuxRuntime()
    case 'subprocess':
      return new SubprocessRuntime()
    default:
      throw new Error(`unknown runtime: ${profile.runtime as string}`)
  }
}
