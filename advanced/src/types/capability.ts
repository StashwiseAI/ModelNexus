export type RuntimeKind = 'api' | 'tmux' | 'subprocess'
export type CostClass = 'low' | 'med' | 'high'
export type StrengthTag =
  | 'reasoning'
  | 'coding'
  | 'vision'
  | 'long-context'
  | 'web'
  | 'web-context'
  | 'math'
  | 'writing'
  | 'synthesis'
  | 'refactor'
  | 'execution'
  | 'tool-use'
  | 'filesystem'
  | 'agentic'
  | 'fast'
  | 'moderator'
  | 'routing'
  | 'balanced'
  | 'multilingual'
  | 'git'

export interface CapabilityProfile {
  id: string
  runtime: RuntimeKind
  strengths: StrengthTag[]
  cost_class: CostClass
  color?: string
  icon?: string
  max_context?: number
  // API runtime
  provider?: 'anthropic' | 'openai' | 'google'
  api_model?: string
  // tmux runtime
  command?: string
  flags?: string[]
  ready_marker?: string
  input_method?: 'sendKeys' | 'pasteFromFile'
  // subprocess runtime
  args_template?: string[]
  prompt_via?: 'stdin' | 'arg'
  timeout_ms?: number
  output_marker_start?: string
  output_marker_end?: string
}

export interface CapabilitiesFile {
  moderator_model: string
  models: CapabilityProfile[]
}
