export type Working = boolean

// One helper of the Clawd team: a subagent, a teammate or a workflow agent.
export type Helper = {
  id: string
  // The task in a few words (the Agent call's description).
  label: string
  // Its agent type: Explore, general-purpose, teammate, workflow...
  kind: string
  status: 'running' | 'waiting' | 'done' | 'failed'
  // When the mod first saw it, and when it finished (ms since the epoch).
  since: number
  doneAt?: number
  // Tool calls it has made, and what it is doing now ("Reading register.tsx").
  tools: number
  activity: string
  // Its desk in the team room, or -1 when every desk is taken.
  slot: number
}

export type TeamStats = { launched: number; done: number; failed: number; workedMs: number }

export type Team = { rows: Helper[]; stats: TeamStats }

declare module 'claude-code' {
  interface PluginState {
    'clawd-theme': { working: Working; tick: number; motion: boolean; team: Team }
  }
}
