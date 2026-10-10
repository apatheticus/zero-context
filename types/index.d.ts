// The $.state contract: every value the module keeps for the session.

// The live window, as `$.session.usage()` last read it. `tokens` and `percent`
// are absent until the first reply, and again right after a compact.
export type Ctx = {
  tokens?: number
  window: number
  percent?: number
  // Where auto-compact runs, in tokens; absent when it is off or unread.
  autoCompact?: number
  at: number
}

// Clear and Handoff take two presses: the first arms this until `until`.
export type Confirm = { action: 'clear' | 'handoff'; until: number }

export type Busy = 'compact' | 'handoff'

// An unused handoff from this folder, offered at the start of a new session.
export type Offer = { file: string; title: string; savedAt: number }

// What `$.store` keeps under `last`, across sessions.
export type Handoff = { file: string; cwd: string; savedAt: number; title: string; used: boolean }

declare module 'claude-code' {
  interface PluginState {
    'zero-context': {
      ctx: Ctx | null
      confirm: Confirm | null
      busy: Busy | null
      offer: Offer | null
    }
  }
}
