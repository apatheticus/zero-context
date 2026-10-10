import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const HOME = '/home/t'
const CWD = '/work/app'
const NOW = 1_000_000_000

const props = (over: Record<string, unknown> = {}) => ({ bodyColumns: 120, hasSurvey: false, isWorking: false, maxRows: 10, ...over })

const mount = ($: Engine, surface: (typeof SURFACES)[number], over: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'zero-context', surface, component: 'AbovePrompt', props: props(over) } as never)

// Everything the band drew, Svg sources and alts included.
const drawn = async (ui: { drawn: () => Promise<unknown> }): Promise<string> => JSON.stringify(await ui.drawn())

type World = { clock: ReturnType<typeof mock.clock>; toasts: string[]; commands: string[]; compacts: string[]; writes: { path: string; text: string }[] }

// The engine's side of each call the plugin makes: what core would answer.
const core = (on: On, store: Record<string, unknown> = {}): World => {
  const w: World = { clock: mock.clock(on, { now: NOW }), toasts: [], commands: [], compacts: [], writes: [] }
  mock.store(on, store)
  mock.env(on, { HOME })
  on('ui.render', async () => ({ type: 'Box' }) as never)
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 1_000_000, breakdown: { autoCompactThreshold: 967_000 } }, rateLimits: [] } }) as never)
  on('session.cwd', async () => ({ value: CWD }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('command.run', async (_$, e) => {
    w.commands.push(e.command)
    return { text: '' }
  })
  // The kit hands on the plugin's own args; the engine stamps `trigger: 'plugin'` live.
  on('session.compact', async (_$, e) => {
    w.compacts.push(e.instructions ?? 'compact')
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] as never, tokensAfter: 20_000 }
  })
  on('fs.write', async (_$, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('classic.SessionStart', async () => ({}))
  return w
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

const measure = ($: Engine, tokens: number, window = 1_000_000) =>
  $.session.measure({ context: { tokens, window, percent: Math.round((tokens / window) * 100) }, rateLimits: [], changed: ['context'] } as never)

test('after a reply the band shows tokens, percent and the three buttons', async ($, on) => {
  core(on)
  await start($)
  await measure($, 142_000)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const text = await drawn(ui)
    expect(text).toContain('142k')
    expect(text).toContain('14%')
    expect(text).toContain('slipping')
    for (const key of ['context-compact', 'context-clear', 'context-handoff']) expect(await ui.find({ key })).toBeDefined()
    expect(await ui.find({ key: 'context-resume' })).toBeUndefined()
    await ui.unmount()
  }
})

test('before the first reply it shows a dash and an empty bar', async ($, on) => {
  core(on)
  await start($)
  const ui = await mount($, 'terminal')
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(text).toContain('—/1M')
  expect(text).not.toContain('┃')
  await ui.unmount()
})

test('Compact runs a plugin compaction in one press', async ($, on) => {
  const w = core(on)
  await start($)
  await measure($, 400_000)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'context-compact' })
    await ui.unmount()
  }
  expect(w.compacts).toEqual(['compact', 'compact'])
  // The summary's size stands in until the next reply.
  const ui = await mount($, 'terminal')
  expect(await drawn(ui)).toContain('20k/1M')
  await ui.unmount()
})

test('while a turn runs a press only says to wait', async ($, on) => {
  const w = core(on)
  await start($)
  await measure($, 142_000)
  const ui = await mount($, 'terminal', { isWorking: true })
  await ui.press({ key: 'context-compact' })
  await ui.press({ key: 'context-clear' })
  expect(w.compacts).toEqual([])
  expect(w.toasts).toEqual(['Wait for the turn to end', 'Wait for the turn to end'])
  await ui.unmount()
})

test('Clear takes two presses', async ($, on) => {
  const w = core(on)
  await start($)
  await measure($, 142_000)
  for (const surface of SURFACES) {
    w.commands.length = 0
    const ui = await mount($, surface)
    await ui.press({ key: 'context-clear' })
    expect((await ui.find({ key: 'context-clear' }))?.text).toBe('Sure?')
    expect(w.commands).toEqual([])
    await ui.press({ key: 'context-clear' })
    expect(w.commands).toEqual(['clear'])
    expect((await ui.find({ key: 'context-clear' }))?.text).toBe('Clear')
    await ui.unmount()
  }
})

test('the Sure? wears off after 3 seconds', async ($, on) => {
  const w = core(on)
  await start($)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'context-clear' })
  await w.clock.advance(3001)
  expect((await ui.find({ key: 'context-clear' }))?.text).toBe('Clear')
  await ui.press({ key: 'context-clear' })
  expect(w.commands).toEqual([])
  await ui.unmount()
})

test('Handoff writes the note, clears, and loads it into the cleared session', async ($, on) => {
  const w = core(on)
  const note = '# Fix the login bug\n## Goal\nLogin works again.\n## Next step\nRun the auth tests.'
  on('model.fork', async () => ({ value: { isAnswered: true, text: note, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  await start($)
  await measure($, 142_000)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'context-handoff' })
  expect(w.writes).toEqual([])
  await ui.press({ key: 'context-handoff' })
  await ui.unmount()

  expect(w.writes).toHaveLength(1)
  expect(w.writes[0]?.path).toContain(`${HOME}/.claude/zero-context/handoffs/`)
  expect(w.writes[0]?.path).toContain('fix-the-login-bug.md')
  expect(w.writes[0]?.text).toContain(`- cwd: ${CWD}`)
  expect(w.writes[0]?.text).toContain('Run the auth tests.')
  expect(w.commands).toEqual(['clear'])

  const started = await $.classic.SessionStart({ source: 'clear' } as never)
  expect((started.additionalContext ?? []).join('\n')).toContain('Run the auth tests.')
  // Loaded once: a second clear carries nothing.
  const again = await $.classic.SessionStart({ source: 'clear' } as never)
  expect(again.additionalContext ?? []).toEqual([])
})

test('a handoff the fork could not write clears nothing', async ($, on) => {
  const w = core(on)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  await start($)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'context-handoff' })
  await ui.press({ key: 'context-handoff' })
  await ui.unmount()
  expect(w.writes).toEqual([])
  expect(w.commands).toEqual([])
  expect(w.toasts.join(' ')).toContain('Nothing was cleared')
})

const saved = (over: Record<string, unknown> = {}) => ({
  last: { file: `${HOME}/.claude/zero-context/handoffs/x.md`, cwd: CWD, savedAt: NOW - 60_000, title: 'Fix the login bug', used: false, ...over },
})

test('a saved handoff from this folder offers Resume, which appends it', async ($, on) => {
  core(on, saved())
  const session = mock.session(on)
  on('fs.read', async () => ({ value: '# Fix the login bug\nRun the auth tests.' }) as never)
  await start($)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ key: 'context-resume' })).toBeDefined()
  await ui.press({ key: 'context-resume' })
  expect(await ui.find({ key: 'context-resume' })).toBeUndefined()
  await ui.unmount()
  const rows = JSON.stringify(session.appended())
  expect(rows).toContain('Run the auth tests.')
})

const STALE: [string, Record<string, unknown>][] = [
  ['a used handoff', { used: true }],
  ["another folder's handoff", { cwd: '/elsewhere' }],
  ['a handoff over a day old', { savedAt: NOW - 25 * 60 * 60 * 1000 }],
]

for (const [name, over] of STALE) {
  test(`${name} offers nothing`, async ($, on) => {
    core(on, saved(over))
    await start($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'context-resume' })).toBeUndefined()
    await ui.unmount()
  })
}

test('a lower hook keeps its row, drawn above the context row', async ($, on) => {
  // Registered first, so it stands above the kit's empty Box: the plugin's `next` reaches it.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', children: [{ type: 'Text', children: ['Progress row'] }] }) as never)
  core(on)
  await start($)
  await measure($, 142_000)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const text = await drawn(ui)
    expect(text).toContain('Progress row')
    expect(text.indexOf('Progress row')).toBeLessThan(text.indexOf('context-compact'))
    await ui.unmount()
  }
})

test('a survey gets the band to itself', async ($, on) => {
  core(on)
  await start($)
  await measure($, 142_000)
  for (const surface of SURFACES) {
    const ui = await mount($, surface, { hasSurvey: true })
    expect(await ui.find({ key: 'context-compact' })).toBeUndefined()
    await ui.unmount()
  }
})
