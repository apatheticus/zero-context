import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

import type { Busy, Ctx, Handoff, Offer } from '../types'
import {
  DAY_MS,
  EMPTY,
  HANDOFF_PROMPT,
  barRuns,
  cellZones,
  colorAt,
  fmtTokens,
  gradientStops,
  handoffContext,
  handoffFile,
  parseZones,
  readout,
  riskOf,
  slug,
  stamp,
  titleOf,
  zoneOf,
} from './meter'

// A context meter above the prompt. The drawing style forks Zero Progress, which
// forks savvy-progress by johnnyvizz (MIT): the dither and the row-as-one-SVG are his.

const ctx = atom({ plugin: 'zero-context', key: 'ctx' } as const, null)
const confirm = atom({ plugin: 'zero-context', key: 'confirm' } as const, null)
const busy = atom({ plugin: 'zero-context', key: 'busy' } as const, null)
const offer = atom({ plugin: 'zero-context', key: 'offer' } as const, null)

const CONFIRM_MS = 3000
const LAST = 'last'

const BUSY_TEXT: Record<Busy, string> = { compact: 'Compacting…', handoff: 'Writing handoff…' }

// A handoff written and waiting for the clear that loads it. A module variable on
// purpose: the clear follows at once, and a reload in between leaves the file and
// the Resume offer of the next session as the fallback.
let armed: { text: string; file: string; title: string } | null = null

// Zone knees, from `userConfig`; set at register.
let knees: number[] = parseZones(undefined)

const ctxOf = (c: SessionContextUsage, autoCompact: number | undefined, at: number): Ctx => {
  const percent = c.percent ?? (c.tokens !== undefined && c.window ? (c.tokens / c.window) * 100 : undefined)
  return {
    window: c.window,
    at,
    ...(c.tokens !== undefined ? { tokens: c.tokens } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(autoCompact !== undefined ? { autoCompact } : {}),
  }
}

const riskNow = (c: Ctx | null): number => (c?.tokens === undefined ? 0 : riskOf(c.tokens, knees, c.autoCompact))

// An engine error, without the `zero-context: ` the engine puts in front: the toast says it already.
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^zero-context: /, '')

const reasonText = (r:{ reason: string; status?: number | null }): string =>
  r.reason === 'nothing-to-fork'
    ? 'there is no reply to hand off yet'
    : r.reason === 'api-error'
      ? `the API answered ${r.status ?? 'with no status'}`
      : r.reason === 'empty-reply'
        ? 'the model wrote nothing'
        : 'it was interrupted'

// ---------------------------------------------------------------------------
// Desktop: the row is one SVG, as Zero Progress's is.

const H = 22
const BAR_H = 14
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// Dots from column `from` to `to`, kept where the noise falls under `density`.
const dither = (from: number, to: number, rows: number, density: number, size: number): string[] => {
  const dots: string[] = []
  for (let c = from; c < to; c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="${size}" height="${size}"/>`)
    }
  }
  return dots
}

const rowSvg = (W: number, c: Ctx | null, side: string): string => {
  const BAR_X = 78
  const SIDE_W = Math.round(side.length * 7 + 12)
  const BAR_W = Math.max(60, W - BAR_X - SIDE_W)
  const y0 = (H - BAR_H) / 2
  const rows = Math.floor(BAR_H / CELL)
  const cols = Math.floor(BAR_W / CELL)
  const hasReading = c?.tokens !== undefined && c.percent !== undefined
  const risk = riskNow(c)
  const color = hasReading ? colorAt(risk) : EMPTY
  const zones = c ? cellZones(cols, c.window, knees, c.autoCompact) : []
  const stops = gradientStops(zones)
    .map(s => `<stop offset="${s.offset.toFixed(4)}" stop-color="${s.color}"/>`)
    .join('')
  const markX = hasReading ? Math.round((BAR_W * Math.min(100, c?.percent ?? 0)) / 100) : 0
  const markCol = Math.floor(markX / CELL)
  const full = hasReading ? dither(0, markCol, rows, 0.8, 2) : []
  const faint = dither(hasReading ? markCol : 0, cols, rows, 0.2, 1.7)
  const pill = hasReading ? fmtTokens(c?.tokens ?? 0) : ''
  const pillW = Math.round(14 + pill.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, markX - pillW / 2))
  // Dark ink reads on lime and amber, white on the rest.
  const ink = zoneOf(risk) === 1 || zoneOf(risk) === 2 ? '#1f1f1f' : '#ffffff'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}}
.t0,.t1,.t2,.t3{animation:tw 3.2s ease-in-out infinite}
.t1{animation-duration:3.8s;animation-delay:-.7s}.t2{animation-duration:4.4s;animation-delay:-1.3s}.t3{animation-duration:3.5s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.75}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${cols * CELL}" y2="0">${stops || `<stop offset="0" stop-color="${EMPTY}"/>`}</linearGradient></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">Context</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="url(#g)">${full.join('')}</g>
<g fill="${hasReading ? 'url(#g)' : EMPTY}" opacity="0.4">${faint.join('')}</g>
</g>
${hasReading ? `<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="600" fill="${ink}">${xml(pill)}</text>` : ''}
</g>
<text class="m" x="${W - 2}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${xml(side)}</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Engine work. Each takes `$`, so each is a top-level function.

async function seed($: EngineInterface): Promise<void> {
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (!u) return
  const at = await $.clock.now()
  await update($, ctx, () => ctxOf(u.context, u.context.breakdown?.autoCompactThreshold, at))
}

// The threshold only moves with the window or a compact: read it again then.
// A step reads it only then; a turn's end also reads it when it is still unknown.
async function measure($: EngineInterface, c: SessionContextUsage, isStep = false): Promise<void> {
  const prev = await read($, ctx)
  const isSameWindow = prev?.window === c.window
  const hasDropped = (c.tokens ?? 0) < (prev?.tokens ?? 0)
  let threshold = isSameWindow ? prev?.autoCompact : undefined
  if ((threshold === undefined && !isStep) || !isSameWindow || hasDropped) {
    const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
    threshold = u?.context.breakdown?.autoCompactThreshold ?? threshold
  }
  const at = await $.clock.now()
  await update($, ctx, () => ctxOf(c, threshold, at))
}

// Each model request of the main thread: its input side is the fill, as the status
// line counts it. session.measure fires only when a turn ends, so a long turn needs this.
async function stepped($: EngineInterface, usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }): Promise<void> {
  const tokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  if (!tokens) return
  const window = (await read($, ctx))?.window || (await $.session.usage().catch(() => null))?.context.window
  if (!window) return
  await measure($, { tokens, window, percent: (tokens / window) * 100 }, true)
}

async function checkOffer($: EngineInterface, cwd: string): Promise<void> {
  const last = (await $.store.get(LAST).catch(() => undefined)) as Handoff | undefined
  const at = await $.clock.now()
  const isFresh = !!last && !last.used && last.cwd === cwd && at - last.savedAt < DAY_MS
  const next: Offer | null = isFresh && last ? { file: last.file, title: last.title, savedAt: last.savedAt } : null
  await update($, offer, () => next)
}

async function markUsed($: EngineInterface, file: string): Promise<void> {
  const last = (await $.store.get(LAST).catch(() => undefined)) as Handoff | undefined
  if (last?.file === file) await $.store.set(LAST, { ...last, used: true })
}

async function arm($: EngineInterface, action: 'clear' | 'handoff'): Promise<void> {
  const until = (await $.clock.now()) + CONFIRM_MS
  await update($, confirm, () => ({ action, until }))
  $.clock.after(CONFIRM_MS, () => void disarm($, until))
}

async function disarm($: EngineInterface, until: number): Promise<void> {
  await update($, confirm, c => (c?.until === until ? null : c))
}

// True when this press is the second one inside the window; it then disarms.
async function isConfirmed($: EngineInterface, action: 'clear' | 'handoff'): Promise<boolean> {
  const c = await read($, confirm)
  const at = await $.clock.now()
  if (c?.action !== action || c.until < at) return false
  await update($, confirm, () => null)
  return true
}

async function compact($: EngineInterface): Promise<string> {
  if (await read($, busy)) return 'Busy.'
  await update($, busy, () => 'compact' as const)
  try {
    const r = await $.session.compact({})
    if (r.skip !== undefined) {
      $.ui.toast(`Compact skipped: ${r.skip}`)
      return `Compact skipped: ${r.skip}`
    }
    // The fill is unknown until the next reply; the summary's size stands in.
    const at = await $.clock.now()
    const tokens = r.tokensAfter
    await update($, ctx, prev => {
      if (!prev) return prev
      const { tokens: _t, percent: _p, ...rest } = prev
      return tokens === undefined ? { ...rest, at } : { ...rest, at, tokens, percent: prev.window ? (tokens / prev.window) * 100 : 0 }
    })
    return 'Compacted.'
  } catch {
    // A headless host (the desktop app, the SDK) refuses it: there a compaction
    // runs only as a `/compact` turn. Queue that, as if typed; if it fails too,
    // the toast says why.
    return await compactAsCommand($)
  } finally {
    await update($, busy, () => null)
  }
}

// Queues `/compact` as if typed. The fill shows a dash until the next reply.
async function compactAsCommand($: EngineInterface): Promise<string> {
  try {
    await $.command.run({ command: 'compact', args: '' })
  } catch (err) {
    const why = `Compact failed: ${errText(err)}. Type /compact`
    $.ui.toast(why)
    return why
  }
  const at = await $.clock.now()
  await update($, ctx, prev => {
    if (!prev) return prev
    const { tokens: _t, percent: _p, ...rest } = prev
    return { ...rest, at }
  })
  return 'Compacted.'
}

async function clear($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    $.ui.toast('Type /clear')
  }
}

// Asks the session for a handoff note, saves it, then clears with it armed.
// Nothing is cleared when the note did not come back or could not be saved.
async function handoff($: EngineInterface): Promise<string> {
  if (await read($, busy)) return 'Busy.'
  await update($, busy, () => 'handoff' as const)
  let note: { text: string; file: string; title: string } | null = null
  try {
    const r = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!r.isAnswered) {
      const why = `Handoff failed: ${reasonText(r)}. Nothing was cleared.`
      $.ui.toast(why)
      return why
    }
    const text = r.text.trim()
    const title = titleOf(text)
    const at = await $.clock.now()
    const [cwd, sessionId, model, home, c] = await Promise.all([
      $.session.cwd(),
      $.session.id(),
      $.session.model(),
      $.env.get('HOME'),
      read($, ctx),
    ])
    const dir = home ? `${home}/.claude/zero-context/handoffs` : `${$.plugin.root}/.handoffs`
    const file = `${dir}/${stamp(at)}-${slug(title)}.md`
    await $.fs.write(file, handoffFile({ cwd, sessionId, model, tokens: c?.tokens, window: c?.window, at }, text))
    const saved: Handoff = { file, cwd, savedAt: at, title, used: false }
    await $.store.set(LAST, saved)
    note = { text, file, title }
  } catch (err) {
    const why = `Handoff failed: ${errText(err)}. Nothing was cleared.`
    $.ui.toast(why)
    return why
  } finally {
    await update($, busy, () => null)
  }
  armed = note
  $.ui.log(`Handoff saved to ${note.file}`)
  await clear($)
  return `Handoff saved to ${note.file}.`
}

async function resume($: EngineInterface): Promise<string> {
  const o = await read($, offer)
  if (!o) return 'No handoff to resume.'
  let text: string
  try {
    text = String(await $.fs.read(o.file))
  } catch {
    $.ui.toast('The handoff file is gone')
    await discard($)
    return 'The handoff file is gone.'
  }
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: handoffContext(text, o.file) }] } })
  await markUsed($, o.file)
  await update($, offer, () => null)
  $.ui.log(`Handoff loaded: ${o.title}`)
  return `Handoff loaded: ${o.title}.`
}

async function discard($: EngineInterface): Promise<void> {
  const o = await read($, offer)
  if (o) await markUsed($, o.file)
  await update($, offer, () => null)
}

async function pressCompact($: EngineInterface, isWorking: boolean): Promise<void> {
  if (isWorking) return $.ui.toast('Wait for the turn to end')
  await compact($)
}

async function pressClear($: EngineInterface, isWorking: boolean): Promise<void> {
  if (isWorking) return $.ui.toast('Wait for the turn to end')
  if (await isConfirmed($, 'clear')) await clear($)
  else await arm($, 'clear')
}

async function pressHandoff($: EngineInterface, isWorking: boolean): Promise<void> {
  if (isWorking) return $.ui.toast('Wait for the turn to end')
  if (await isConfirmed($, 'handoff')) await handoff($)
  else await arm($, 'handoff')
}

// The cleared session: the meter starts over, and an armed handoff is loaded.
async function afterClear($: EngineInterface): Promise<string | undefined> {
  await update($, confirm, () => null)
  await seed($)
  const h = armed
  armed = null
  if (!h) return undefined
  await markUsed($, h.file)
  $.ui.log(`Handoff loaded: ${h.title}`)
  return handoffContext(h.text, h.file)
}

async function statusText($: EngineInterface): Promise<string> {
  const c = await read($, ctx)
  const o = await read($, offer)
  const line = c ? `Context: ${readout(c.tokens, c.window, c.percent, riskNow(c))}` : 'Context: no reading yet.'
  return o ? `${line}\nA handoff waits: ${o.title}. /zero-context resume loads it.` : line
}

const USAGE = 'Usage: /zero-context [compact|clear|handoff|resume]'

export const register: Register = (on, options) => {
  knees = parseZones(typeof options.zones === 'string' ? options.zones : undefined)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'zero-context',
      description: 'Context meter: compact, clear, or hand off to a fresh session; no argument shows the fill',
      argumentHint: '[compact|clear|handoff|resume]',
    })
    await seed($)
    await checkOffer($, e.cwd)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('context')) await measure($, e.context)
    return measured
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result.usage) await stepped($, result.usage).catch(() => undefined)
    return result
  })

  // /clear fires no session.start: this is where the cleared session begins.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (e.source !== 'clear') return started
    const context = await afterClear($)
    return context ? { ...started, additionalContext: [...(started.additionalContext ?? []), context] } : started
  }).catch(($, e, next) => next(e))

  // Typing the command is the confirmation, so clear and handoff run at once.
  // The work runs off a timer: a command hook that waits on another command stalls.
  on('command.run', { command: 'zero-context' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (!arg) return { text: await statusText($) }
    if (arg === 'compact') {
      $.clock.after(0, () => void compact($))
      return { text: 'Compacting…' }
    }
    if (arg === 'clear') {
      $.clock.after(0, () => void clear($))
      return { text: 'Clearing…' }
    }
    if (arg === 'handoff') {
      $.clock.after(0, () => void handoff($))
      return { text: 'Writing handoff…' }
    }
    if (arg === 'resume') return { text: await resume($) }
    return { text: USAGE }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Whatever draws beneath (Zero Progress's bar) stays, above this row.
    const below = await next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const c = await read($, ctx)
    const armedFor = (await read($, confirm))?.action
    const isBusy = await read($, busy)
    const o = await read($, offer)
    const isWorking = e.props.isWorking
    const hasReading = c?.tokens !== undefined && c.percent !== undefined
    const risk = riskNow(c)
    const color = hasReading ? colorAt(risk) : EMPTY
    const side = readout(c?.tokens, c?.window ?? 0, c?.percent, risk)

    const buttons = isBusy
      ? [
          <Text key="context-busy" dimColor>
            {BUSY_TEXT[isBusy]}
          </Text>,
        ]
      : [
          <Button key="context-compact" label="Compact" hotkey="c" plain dimColor={isWorking} onPress={() => pressCompact($, isWorking)} />,
          <Button
            key="context-clear"
            label={armedFor === 'clear' ? 'Sure?' : 'Clear'}
            hotkey="x"
            plain
            dimColor={isWorking}
            onPress={() => pressClear($, isWorking)}
          />,
          <Button
            key="context-handoff"
            label={armedFor === 'handoff' ? 'Sure?' : 'Handoff'}
            hotkey="h"
            plain
            dimColor={isWorking}
            onPress={() => pressHandoff($, isWorking)}
          />,
          ...(o
            ? [
                <Button key="context-resume" label="Resume" hotkey="r" plain onPress={() => void resume($)} />,
                <Button key="context-discard" label="Discard" hotkey="d" plain dimColor onPress={() => discard($)} />,
              ]
            : []),
        ]

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per column; the rest holds the buttons and their gaps.
      const width = Math.max(200, Math.min(1400, (e.props.bodyColumns || 100) * 8 - (o ? 420 : 270)))
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={rowSvg(width, c, side)} alt={`Context ${side}`} width={width} height={H} />
            {buttons}
          </Box>
        </Box>
      )
    }

    // Terminal: the label, the bar, the readout and the buttons, the bar taking what is left.
    // `c: Compact` `x: Clear` `h: Handoff`, `r: Resume` `d: Discard`, and two columns between items.
    const labels = isBusy ? BUSY_TEXT[isBusy].length + 6 : 28 + 10 + (o ? 19 + 4 : 0)
    const width = Math.max(6, Math.min(40, e.props.bodyColumns - 9 - side.length - labels))
    const zones = c ? cellZones(width, c.window, knees, c.autoCompact) : [...Array(width)].map(() => 0)
    const runs = barRuns(zones, hasReading ? c?.percent : undefined)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={2}>
          <Box flexShrink={0}>
            <Text color={color}>● </Text>
            <Text>Context</Text>
          </Box>
          <Text>
            {runs.map((r, i) => (
              <Text key={`run-${i}`} color={r.color} bold={r.isMarker}>
                {r.text}
              </Text>
            ))}
          </Text>
          <Text bold={hasReading} dimColor={!hasReading} wrap="truncate-end">
            {side}
          </Text>
          {buttons}
        </Box>
      </Box>
    )
  })
}
