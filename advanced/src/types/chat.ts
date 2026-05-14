export type ChatStatus = 'active' | 'disbanding' | 'disbanded'

export interface NexusChat {
  id: string
  template_id: string | null
  task: string
  status: ChatStatus
  models_json: string
  system_prompt: string | null
  min_duration_minutes: number
  created_at: number
  disbanded_at: number | null
}

export interface TeamTemplate {
  id: string
  description: string
  models: string[]
  moderator: string
  system_prompt: string
  min_duration_minutes: number
}

export interface TeamsFile {
  templates: TeamTemplate[]
}
