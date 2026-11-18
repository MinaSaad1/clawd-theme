# clawd-theme

A theme mod for the Claude Code desktop app, with a pixel Clawd team that shows your subagents at work.

> Unofficial, fan-made theme. Not affiliated with or endorsed by Anthropic. Claude, Clawd and the Claude
> starburst logo are Anthropic's.

- **Main Clawd** sits at a desk right of the chat. It dozes while idle and types at its laptop while Claude
  works, under a floating terminal that scrolls code.
- **The Clawd team** fills the strip left of the chat:
  - **Team board** (top): one row per subagent, teammate or workflow agent with its task, what it is doing
    right now ("Reading register.tsx", "Searching ..."), its type, a running timer and its tool-call count,
    then the session's totals (launched, done, stopped, time worked).
  - **Team room** (bottom): a desk per helper, up to five. When nobody is working, team members sleep under
    blankets. A new helper's task flies over from main Clawd's desk as a paper, the helper walks in and types,
    and one at a time they say what they are on. When done they celebrate, send a checked paper back, close
    the laptop, pull up a blanket and fall asleep at their desk.
  - A wall clock and a potted plant.
- Warm cream or charcoal colours. The accent colour stays the app's own, so the usage-limit and context meters,
  buttons and links keep Claude's default colours.

## Install

At the prompt of a terminal session:

```
/plugin install clawd-theme --marketplace MinaSaad1/clawd-theme
```

From a shell:

```
claude plugin install clawd-theme --marketplace MinaSaad1/clawd-theme
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `MinaSaad1/clawd-theme`, then **Add plugin**.

Answer `y` to add the marketplace, then pick the user scope. A mod installed at the user scope from a terminal
also loads in the desktop app's local sessions.

**Needs** the Claude Code desktop app with mods (Claude Code 2.1.286 or later in the Code tab; check with
`/status`). The scene draws in local sessions of the desktop app; the terminal keeps its own look.

## Before you install

A mod runs with your permissions and is not sandboxed. Read `hooks/register.tsx` first, or list what it does:

```
claude plugin validate ./clawd-theme
```

This one sets a theme, registers `/clawd-motion`, lists your session's agents once a second, and watches tool
calls and turns to show what each helper is doing. It makes no network requests and writes no files.

## Controls

- `/clawd-motion off` holds one still frame and stops the animation (the clock and the team board still update).
- `/clawd-motion on` starts it again.

The app shows a backdrop as a still picture, so the mod redraws it 10 times a second as frames, and the app
re-blurs its panels each frame. That costs some CPU; `/clawd-motion off` is the switch if your machine feels it.

## Tuning

In `hooks/register.tsx`:

- `WORKING_FRAME_MS`, `IDLE_FRAME_MS`: frame times (100 ms = 10 fps; 600 ms idle is lighter but choppier)
- `LOOK.backdrop.glass`: blur and opacity of the panels over the scene; less blur costs less CPU
- `SLOT.desktop`: where main Clawd's scene sits (right 18 % of the window)
- `LEFT_SLOT`, `SEATS`: the team room and its desks; `TEAM_SLOT`, `TEAM_ROWS`: the board
- `PAPER_MS`, `WALK_IN_AT`, `WALK_MS`, `CELEBRATE_MS`, `TUCK_MS`: the hand-off timeline; `PRUNE_AFTER`,
  `FADE_MS`: how long a finished helper stays on the board; `BLANKET*`: the blanket's colours
- `localHoursMinutes`: the wall clock's time zone (set to Cairo, with Egypt's summer time)
- `roles` in `makeColors`: add `accent` to paint meters and buttons in the theme's colour too

How the team is tracked: `$.agent.list()` once a second, `agent.spawn` for workflow agents (which never appear
in that list), `tool.call` for each helper's live activity, `turn.complete` for when it finishes. Background
shell commands are not shown (no API lists them).
