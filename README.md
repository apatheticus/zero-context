# zero-context

A Claude Code mod: a context meter above the prompt. It shows how full the window is, colored by how much the fill hurts output, with buttons to **Compact**, **Clear** or **Handoff**.

## Install

Type this at the Claude Code prompt in a terminal:

```
/plugin install zero-context --marketplace apatheticus/zero-context
```

Answer `y` to add the marketplace, then pick the user scope.

Or from a shell:

```sh
claude plugin marketplace add apatheticus/zero-context
claude plugin install zero-context@zero-context
```

The drawing style forks [Zero Progress](https://github.com/apatheticus/zero-progress), which forks [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz (MIT). The dither and the one-SVG row are his.

## What the bar shows

```
● Context  ██████┃░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  142k/1M 14% slipping  c: Compact  x: Clear  h: Handoff
```

- **The track is fixed.** Each cell stands for its slice of the window and wears that token count's color. On a 1M window red starts about 30% along; on 200k it follows the auto-compact line.
- **The marker** sits at the fill's percent of the window.
- **The color** is set by raw tokens, not percent. Knees at 60k, 120k, 200k and 300k split it into five zones: sharp (green), fine (lime), slipping (amber), lossy (orange), rot (red).
- **Near auto-compact** it turns red anyway: from 75% of the threshold to 90%, the risk climbs to red.
- Before the first reply, and right after a compact, it shows `—` until the next reply.

## The buttons

Press them with a click, or focus the band (ctrl+x tab) and use the letter.

- **Compact** (`c`): one press. Same as `/compact`.
- **Clear** (`x`): two presses. The first turns the label into `Sure?` for 3 seconds.
- **Handoff** (`h`): two presses. It asks the session for a handoff note (goal, decisions, files, state, open questions, next step, under 600 words), saves it to `~/.claude/zero-context/handoffs/`, clears, and loads the note into the cleared session.
- **Resume** (`r`) and **Discard** (`d`): shown when a new session starts in a folder whose last handoff, under a day old, was never loaded.

While a turn runs the buttons draw dim, and a press only says to wait.

`/zero-context [compact|clear|handoff|resume]` does the same from the keyboard. Typing it is the confirmation, so `clear` and `handoff` run at once. With no argument it prints the fill.

## Settings

`zones` (default `"60,120,200,300"`): the four knees, in thousands of tokens, rising. A bad value falls back to the default.

```json
{ "pluginConfigs": { "zero-context": { "options": { "zones": "40,80,160,240" } } } }
```

## With Zero Progress

Both mods draw in the band above the prompt. Each draws what sits beneath it, then its own row, so Zero Progress's bar shows above the meter. That needs Zero Progress with the stacking change.

## Notes

- The mod API is early access; a Claude Code update can break it.
- Handoff relies on a plugin running `/clear`. If Claude Code refuses it, a toast says "Type /clear", and the armed note loads when you do.

## Develop

```sh
claude --plugin-dir .          # run it live; edits reload at the end of each turn
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p .   # needs .claude-plugin/types/, written by the first --plugin-dir load
```
