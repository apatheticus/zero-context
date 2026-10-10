// The meter's math and words: zones, risk, color, cells and the handoff prompt.
// No `$` here, so the tests import it whole.

// Where the fill starts to hurt, in tokens: the knees between the five zones.
export const DEFAULT_KNEES: readonly number[] = [60_000, 120_000, 200_000, 300_000]

// Green, lime, amber, orange, red: one per zone, risk 0 to 1 in quarters.
export const COLORS: readonly string[] = ['#3fb950', '#a3c639', '#e3b341', '#f0883e', '#f85149']

export const WORDS: readonly string[] = ['sharp', 'fine', 'slipping', 'lossy', 'rot']

// The empty track before the first reply.
export const EMPTY = '#6e7681'

// "60,120,200,300" in thousands of tokens. Anything but four rising positive
// numbers falls back to the defaults.
export const parseZones = (s: string | undefined): number[] => {
  const parts = String(s ?? '')
    .split(',')
    .map(p => Number(p.trim()))
  const isGood = parts.length === 4 && parts.every((n, i) => Number.isFinite(n) && n > 0 && (i === 0 || n > (parts[i - 1] ?? 0)))
  return isGood ? parts.map(n => n * 1000) : [...DEFAULT_KNEES]
}

// 0 at no tokens, a quarter more at each knee, linear between, 1 past the last.
export const tokenRisk = (tokens: number, knees: readonly number[]): number => {
  const points = [0, ...knees]
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1] ?? 0
    const hi = points[i] ?? 0
    if (tokens < hi) return (i - 1 + Math.max(0, tokens - lo) / (hi - lo)) / 4
  }
  return 1
}

// Near the auto-compact line: 0.75 at 75% of it, rising to 1 at 90%.
export const compactRisk = (tokens: number, threshold: number | undefined): number => {
  if (!threshold || threshold <= 0) return 0
  const start = threshold * 0.75
  const end = threshold * 0.9
  if (tokens < start) return 0
  return 0.75 + 0.25 * Math.min(1, (tokens - start) / (end - start))
}

export const riskOf = (tokens: number, knees: readonly number[], threshold?: number): number =>
  Math.max(tokenRisk(tokens, knees), compactRisk(tokens, threshold))

// The zone a risk falls in: each quarter is one zone, and only a full 1 is red.
export const zoneOf = (risk: number): number => Math.max(0, Math.min(4, Math.floor(risk * 4)))

export const colorAt = (risk: number): string => COLORS[zoneOf(risk)] ?? EMPTY

export const wordAt = (risk: number): string => WORDS[zoneOf(risk)] ?? ''

// The track is fixed: cell `i` stands for the middle of its slice of the window
// and wears that token count's zone, wherever the session stands now.
export const cellZones = (width: number, window: number, knees: readonly number[], threshold?: number): number[] =>
  [...Array(width)].map((_, i) => zoneOf(riskOf(((i + 0.5) / width) * window, knees, threshold)))

// The cell the marker sits on.
export const markerCell = (percent: number, width: number): number =>
  Math.max(0, Math.min(width - 1, Math.round((percent * width) / 100)))

export type Run = { text: string; color: string; isMarker?: boolean }

// The terminal bar: full blocks up to the marker, the marker, light shade after,
// each cell in its zone's color; neighbours alike merge into one run. With no
// reading yet the whole track is light shade in grey.
export const barRuns = (zones: readonly number[], percent: number | undefined): Run[] => {
  if (percent === undefined) return zones.length ? [{ text: '░'.repeat(zones.length), color: EMPTY }] : []
  const at = markerCell(percent, zones.length)
  const runs: Run[] = []
  zones.forEach((z, i) => {
    const color = COLORS[z] ?? EMPTY
    if (i === at) {
      runs.push({ text: '┃', color, isMarker: true })
      return
    }
    const glyph = i < at ? '█' : '░'
    const last = runs[runs.length - 1]
    if (last && !last.isMarker && last.color === color && last.text.startsWith(glyph)) last.text += glyph
    else runs.push({ text: glyph, color })
  })
  return runs
}

// The same zones as hard-edged gradient stops, for the desktop's SVG track.
export const gradientStops = (zones: readonly number[]): { offset: number; color: string }[] => {
  const stops: { offset: number; color: string }[] = []
  const n = zones.length
  zones.forEach((z, i) => {
    if (i > 0 && zones[i - 1] === z) return
    const color = COLORS[z] ?? EMPTY
    const offset = i / n
    const prev = stops[stops.length - 1]
    if (prev) stops.push({ offset, color: prev.color })
    stops.push({ offset, color })
  })
  if (stops.length) stops.push({ offset: 1, color: stops[stops.length - 1]?.color ?? EMPTY })
  return stops
}

export const fmtTokens = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return `${Math.round(n)}`
}

// `142k/1M 14% slipping`, or `—/1M` before the first reply.
export const readout = (tokens: number | undefined, window: number, percent: number | undefined, risk: number): string =>
  tokens === undefined || percent === undefined
    ? `—${window ? '/' + fmtTokens(window) : ''}`
    : `${fmtTokens(tokens)}/${fmtTokens(window)} ${Math.round(percent)}% ${wordAt(risk)}`

// ---------------------------------------------------------------------------
// The handoff.

export const HANDOFF_PROMPT = `Write a handoff note so a fresh session can pick up this work with no other context. It replaces this conversation.

Start with one line: \`# \` and a title of at most 8 words.
Then these sections, as Markdown headings, each short and concrete:
## Goal
What we are trying to do, and why.
## Decisions
What was decided, and the reason for each.
## Files
Every file read or changed that matters, by exact path, with one line on its part.
## State
What works now, what is half-done, what is broken. Name failing tests or errors exactly.
## Open questions
What is still undecided or unknown.
## Next step
The exact next action, specific enough to start on at once.

Under 600 words. Facts only, no pleasantries. Reply with the note alone.`

export const titleOf = (text: string): string => {
  const line = text.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  const m = /^#+\s*(.+)$/.exec(line)
  const title = (m?.[1] ?? line).replace(/[`*_]/g, '').trim()
  return title.length > 80 ? title.slice(0, 79) + '…' : title || 'Handoff'
}

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'handoff'

// `2026-10-10T17-08-00Z`: an ISO time a file name can hold.
export const stamp = (at: number): string => new Date(at).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')

export type HandoffMeta = { cwd: string; sessionId: string; model: string; tokens?: number; window?: number; at: number }

export const handoffFile = (meta: HandoffMeta, text: string): string =>
  [
    '<!-- zero-context handoff -->',
    `- cwd: ${meta.cwd}`,
    `- session: ${meta.sessionId}`,
    `- model: ${meta.model}`,
    `- tokens: ${meta.tokens === undefined ? 'unknown' : fmtTokens(meta.tokens)}${meta.window ? '/' + fmtTokens(meta.window) : ''}`,
    `- saved: ${new Date(meta.at).toISOString()}`,
    '',
    text.trim(),
    '',
  ].join('\n')

// What the model reads in the cleared or new session.
export const handoffContext = (text: string, file: string): string =>
  `Handoff from the previous session, saved to ${file}. Pick up the work from here; the earlier conversation is gone.\n\n${text.trim()}`

// Under a day old, from this folder, not yet used.
export const DAY_MS = 24 * 60 * 60 * 1000
