# zero-context

A Claude Code mod (hooks-module plugin): a context meter above the prompt. This repo is the plugin and its own marketplace.

## Layout
- `.claude-plugin/plugin.json`: the manifest. `version` must match the entry in `marketplace.json`.
- `.claude-plugin/marketplace.json`: one entry, `source: "./"`.
- `hooks/register.tsx`: the hooks, the actions and the drawing.
- `hooks/meter.ts`: zones, risk, color, cells, readout and the handoff prompt. No `$`; the tests import it.
- `types/index.d.ts`: the `$.state` contract. Every `$.state` key the module uses is declared here.
- `tests/*.test.ts`: run by `claude plugin test`.

## Develop
- Run it live: `claude --plugin-dir /Volumes/Data/dev/zero-context`. Edits hot-reload at the end of each turn.
- With Zero Progress: add `--plugin-dir /Volumes/Data/dev/zero-progress`. Its bar should sit above the meter.
- That first load writes `.claude-plugin/types/` (gitignored). `tsc` needs it.

## Check before every commit
```sh
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p .
```

## Release
1. If the change touches Clear, Handoff or Resume, try each live: after Handoff, ask "what were we doing?" and the model must know.
2. Bump `version` in both `plugin.json` and `marketplace.json`.
3. Commit and push to `main`.
4. Update the installed copy: `claude plugin marketplace update zero-context`, then `claude plugin update zero-context@zero-context`.

## Gotchas
- The band is one instance. Draw `await next(e)` above the row, or another mod's row vanishes.
- The terminal has no `Svg` element. Guard desktop drawing with `e.surface === 'desktop' && 'Svg' in ui`.
- Render hooks only read. `confirm` wears off from a `$.clock.after` callback, never while drawing.
- `session.measure` fires when a main turn ends (and on a rate-limit tick), never mid-turn. The `turn.step` hook keeps the meter live through a long turn; skip steps with an `agentId`.
- `/clear` fires no `session.start`. The cleared session starts in the `classic.SessionStart` hook, `source: 'clear'`.
- `$.session.compact` rejects in a headless host (the desktop app, the SDK): compaction there runs only as a `/compact` turn. `compact` falls back to `$.command.run({ command: 'compact' })` on any rejection. The kit can't reject with that message; a `session.compact` hook that answers `next(e)` stands in.
- `$.model.fork` must run before the clear: after it there is nothing to fork.
- `armed` is a module variable: a reload between Handoff and the clear drops it. The file and the next session's Resume are the fallback.
- A command hook must not await another command. `/zero-context` runs its work off `$.clock.after(0)`.
- The validator only lets `$` reach top-level function declarations.
- In tests, the kit hands a call on as the plugin made it: `session.compact` sees `{}`, not `trigger: 'plugin'` (the engine stamps that live). A compact answer needs `messages` with at least one `{ role, text, toolUses: [] }`.
- In tests, register a lower `ui.render` hook before the kit's catch-all `{ type: 'Box' }`, or the catch-all answers first.
