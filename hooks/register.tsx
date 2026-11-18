import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, Register, ThemeSetArgs } from 'claude-code'

import type { Helper, Team, TeamStats } from '../types'

import { LOGO_PATH } from './logo.js'
import { makeColors } from './make-colors.js'

const PLUGIN = 'clawd-theme'
const SCENE = 'clawd'

// True while the main loop runs a turn: the mascot works, otherwise it idles.
const working = atom({ plugin: 'clawd-theme', key: 'working' } as const, false)
// Bumped by a timer: each bump redraws the backdrop as the next frame.
const tick = atom({ plugin: 'clawd-theme', key: 'tick' } as const, 0)
// False after `/clawd-motion off`: the scene holds one still frame and the timer
// stops redrawing it.
const motion = atom({ plugin: 'clawd-theme', key: 'motion' } as const, true)
// The Clawd team: this session's subagents, teammates and workflow agents,
// and the session's totals.
const EMPTY_TEAM: Team = { rows: [], stats: { launched: 0, done: 0, failed: 0, workedMs: 0 } }
const teamAtom = atom({ plugin: 'clawd-theme', key: 'team' } as const, EMPTY_TEAM)

// The app shows the backdrop as a still picture (neither CSS nor SMIL
// animation plays), so the mod animates it as a flipbook: every frame is a
// static SVG with each moving part placed where the clock says it is.
const WORKING_FRAME_MS = 100
// Same as working: idle runs at the full 10 fps too (600 here was ~1.7 fps,
// lighter on CPU but choppy).
const IDLE_FRAME_MS = 100

// Warm cream by day, warm charcoal by night, clay as the accent.
const { theme, problems } = makeColors({
  label: 'Clawd',
  roles: { danger: '#b3392f', success: '#5a8a3a', warning: '#b07a14', pro: '#7a5ea8' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#ebe8df',
        'surface-1': '#f0eee6',
        'surface-2': '#faf9f5',
        'text-primary': '#1f1e1b',
        'text-secondary': '#4a4740',
        'text-muted': '#6b675d',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1f1e1c',
        'surface-1': '#262624',
        'surface-2': '#2d2c29',
        'surface-3': '#35332f',
        'text-primary': '#f2efe8',
        'text-secondary': '#cfcabf',
        'text-muted': '#a8a296',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE, glass: { blur: 10, opacity: 0.5 } },
}

const CLAY = '#d97757'
const CLAY_HI = '#ec9a7f'
const CLAY_LO = '#b85a3c'
const OUT = '#9a4a30'
const INK = '#1f1e1b'
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽']

// Wave shapes over a period p, all in [0, 1].
const saw = (t: number, p: number) => (((t % p) + p) % p) / p
const wave = (t: number, p: number) => (1 - Math.cos(2 * Math.PI * saw(t, p))) / 2
const f = (n: number) => n.toFixed(2)
// Eases 0 to 1 in and out, landing softly (smootherstep).
const ease = (p: number) => {
  const q = Math.min(1, Math.max(0, p))
  return q * q * q * (q * (q * 6 - 15) + 10)
}
// Fades in over the first `rise` of a cycle, then out to the end.
const fade = (p: number, rise: number, peak: number) => (p < rise ? (p / rise) * peak : peak * (1 - (p - rise) / (1 - rise)))

// The real Claude starburst, centred on (cx, cy) at `size` across.
function logo(cx: number, cy: number, size: number): string {
  return `<path d="${LOGO_PATH}" fill="${CLAY}" shape-rendering="geometricPrecision" transform="translate(${cx} ${cy}) scale(${size / 1000})"/>`
}

// Deterministic pseudo-random, so every frame draws the same sky.
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

const STARS = Array.from({ length: 34 }, (_, i) => ({
  x: Math.round(rand(i + 1) * 1560 + 20),
  y: Math.round(rand(i + 101) * 900 + 20),
  s: rand(i + 201) > 0.7 ? 6 : 4,
  d: rand(i + 301) * 4,
}))

// Code for the floating terminal: drawn twice so the scroll loops seamlessly.
const LINE_COLORS = [CLAY, '#e8e2d4', '#9ccf7a', '#8fb3e0', '#e8e2d4', '#f0c060']
function codeLines(offset: number): string {
  let out = ''
  for (let i = 0; i < 10; i++) {
    const indent = [0, 8, 8, 16, 16, 8, 0, 8, 16, 0][i] ?? 0
    const w = Math.min(20 + Math.round(rand(i + 401) * 70), 110 - indent)
    const c = LINE_COLORS[i % LINE_COLORS.length] ?? CLAY
    const y = offset - 156 + i * 9
    out += `<rect x="${10 + indent}" y="${y}" width="${w}" height="4" fill="${c}"/>`
    if (rand(i + 501) > 0.5 && 10 + indent + w + 26 < 130) {
      out += `<rect x="${10 + indent + w + 5}" y="${y}" width="${10 + Math.round(rand(i + 601) * 10)}" height="4" fill="#6b675d"/>`
    }
  }
  return out
}
const CODE = codeLines(0) + codeLines(90)
const GLYPHS = ['{ }', '</>', '01', ';', '#', '=>']

// Where the vignette sits: desktop pins it in the free strip right of the chat
// column (the right ~18% of the window); a phone gives it more of the width.
const SLOT = {
  desktop: { x: '81.5%', y: '2%', width: '15.5%', height: '90%' },
  mobile: { x: '50%', y: '8%', width: '46%', height: '80%' },
} as const

// ---- The left strip: the Clawd team (desktop only) ----
//
// Top: the team board, one row per helper with what it is doing right now.
// Bottom: the team room, a desk per helper. A helper walks in when it starts,
// types at its desk, celebrates when done and walks out. Papers fly between
// main Clawd's desk and the room when work is handed off and handed back.

// The room shares the desk's viewBox, so both floors sit on the same line.
const LEFT_SLOT = { x: '3%', y: '2%', width: '15.5%', height: '90%' } as const
const TEAM_SLOT = { x: '2.5%', y: '5%', width: '16.5%', height: '40%' } as const
const TEAM_ROWS = 3
// Desk seats in the room (viewBox units): the front row first, then the back.
const SEATS = [
  { x: 11, y: 194 },
  { x: 57, y: 194 },
  { x: 103, y: 194 },
  { x: 34, y: 140 },
  { x: 80, y: 140 },
] as const
const SEAT_COUNT = SEATS.length
// The hand-off timeline, in ms.
const PAPER_MS = 1400
const WALK_IN_AT = 1000
const WALK_MS = 1500
const CELEBRATE_MS = 2500
const PAPER_BACK_AT = 500
// After celebrating, a helper stays at its desk, pulls up a blanket and
// falls asleep; from SETTLED_AT on it is a sleeper like the rest.
const TUCK_MS = 1400
const SETTLED_AT = CELEBRATE_MS + TUCK_MS
// A finished helper leaves the board this long after it fell asleep; one at a
// back desk fades out over FADE_MS before then (the front desks keep sleepers).
const PRUNE_AFTER = 20_000
const FADE_MS = 1500
// Where papers start and land, in % of the window: main Clawd's laptop, and
// a seat in the room (the room is width-bound, so x maps exactly; y is near).
const MAIN_DESK = { x: 88.8, y: 80 }
const seatPct = (slot: number) => {
  const seat = SEATS[slot] ?? SEATS[0]
  return { x: 3 + (15.5 * (seat.x + 12)) / 174, y: seat.y > 180 ? 86 : 80 }
}

// Cairo time for the wall clock: UTC+2, UTC+3 from the last Friday of April
// to the last Thursday of October (Egypt's summer time). Change for elsewhere.
function lastWeekday(year: number, month: number, weekday: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0))
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
}
function localHoursMinutes(ms: number): { h: number; m: number } {
  const year = new Date(ms).getUTCFullYear()
  const dstStart = Date.UTC(year, 3, lastWeekday(year, 3, 5)) - 2 * 3600_000
  const dstEnd = Date.UTC(year, 9, lastWeekday(year, 9, 4) + 1) - 3 * 3600_000
  const offset = ms >= dstStart && ms < dstEnd ? 3 : 2
  const local = new Date(ms + offset * 3600_000)
  return { h: local.getUTCHours(), m: local.getUTCMinutes() }
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const clock2 = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function wallClock(cx: number, cy: number, nowMs: number): string {
  const { h, m } = localHoursMinutes(nowMs)
  const rad = (deg: number) => (deg * Math.PI) / 180
  const hand = (deg: number, len: number, w: number) =>
    `<line x1="${cx}" y1="${cy}" x2="${f(cx + len * Math.sin(rad(deg)))}" y2="${f(cy - len * Math.cos(rad(deg)))}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = rad(i * 30)
    const r1 = i % 3 === 0 ? 11 : 13
    return `<line x1="${f(cx + r1 * Math.sin(a))}" y1="${f(cy - r1 * Math.cos(a))}" x2="${f(cx + 15 * Math.sin(a))}" y2="${f(cy - 15 * Math.cos(a))}" stroke="#6b675d" stroke-width="${i % 3 === 0 ? 1.6 : 0.8}"/>`
  }).join('')
  return `<circle cx="${cx + 2}" cy="${cy + 2}" r="20" fill="#000" opacity=".2"/>
 <circle cx="${cx}" cy="${cy}" r="20" class="woodlo"/>
 <circle cx="${cx}" cy="${cy}" r="17" fill="#e8e2d4"/>
 ${ticks}${hand((h % 12) * 30 + m * 0.5, 8, 2.6)}${hand(m * 6, 13, 1.6)}
 <circle cx="${cx}" cy="${cy}" r="2" fill="${CLAY}"/>`
}

// A potted plant standing on the floor at x; it sways faster while Claude works.
function plant(x: number, floor: number, t: number, isWorking: boolean): string {
  const sway = isWorking ? 5 * (wave(t, 1.6) - 0.5) : 3 * (wave(t, 8) - 0.5)
  const leaf = (dx: number, dy: number, w: number, hh: number, c: string) =>
    `<rect x="${x + dx}" y="${floor + dy}" width="${w}" height="${hh}" fill="${c}"/>`
  return `<g transform="rotate(${f(sway)} ${x} ${floor - 18})">
   ${leaf(-3, -58, 5, 42, '#4f7a33')}
   ${leaf(-15, -46, 12, 5, '#5a8a3a')}${leaf(-19, -51, 7, 5, '#6fa34a')}
   ${leaf(2, -52, 12, 5, '#5a8a3a')}${leaf(10, -59, 7, 7, '#6fa34a')}
   ${leaf(-13, -30, 11, 5, '#6fa34a')}${leaf(-19, -35, 7, 5, '#5a8a3a')}
   ${leaf(2, -34, 11, 5, '#6fa34a')}${leaf(10, -39, 7, 5, '#5a8a3a')}
   ${leaf(-5, -65, 9, 7, '#6fa34a')}
  </g>
  <rect x="${x - 12}" y="${floor - 16}" width="24" height="16" fill="${CLAY_LO}"/>
  <rect x="${x - 14}" y="${floor - 18}" width="28" height="4" fill="${CLAY}"/>
  <rect x="${x - 12}" y="${floor - 14}" width="3" height="14" fill="${CLAY_HI}" opacity=".5"/>`
}

function desk(x: number, floor: number): string {
  return `<rect x="${x - 23}" y="${floor - 20}" width="46" height="4" class="wood"/>
  <rect x="${x - 23}" y="${floor - 16}" width="46" height="2" class="woodlo"/>
  <rect x="${x - 21}" y="${floor - 16}" width="3" height="16" class="woodlo"/>
  <rect x="${x + 18}" y="${floor - 16}" width="3" height="16" class="woodlo"/>`
}

// Where a helper is in its day: not here yet, walking in, at its desk,
// celebrating (drooping), pulling up its blanket, or asleep at its desk.
type Phase =
  | { kind: 'hidden' }
  | { kind: 'walk'; x: number; floor: number; step: number }
  | { kind: 'seat' }
  | { kind: 'party'; p: number }
  | { kind: 'tuck'; p: number }
  | { kind: 'sleep'; opacity: number }

// A helper that finishes before it reached its desk still sits down first.
const finishedAt = (h: Helper) => (h.doneAt === undefined ? undefined : Math.max(h.doneAt, h.since + WALK_IN_AT + WALK_MS))

function phaseOf(h: Helper, nowMs: number, live: boolean): Phase {
  const seat = SEATS[h.slot]
  if (seat === undefined) {
    return { kind: 'hidden' }
  }
  const end = finishedAt(h)
  if (!live) {
    return end === undefined ? { kind: 'seat' } : { kind: 'sleep', opacity: 1 }
  }
  if (end === undefined || nowMs < end) {
    const a = nowMs - h.since - WALK_IN_AT
    if (a < 0) {
      return { kind: 'hidden' }
    }
    if (a < WALK_MS) {
      const p = a / WALK_MS
      return { kind: 'walk', x: -30 + (seat.x + 30) * p, floor: seat.y, step: Math.floor(a / 180) % 2 }
    }
    return { kind: 'seat' }
  }
  const d = nowMs - end
  if (d < CELEBRATE_MS) {
    return { kind: 'party', p: d / CELEBRATE_MS }
  }
  if (d < SETTLED_AT) {
    return { kind: 'tuck', p: (d - CELEBRATE_MS) / TUCK_MS }
  }
  const left = SETTLED_AT + PRUNE_AFTER - d
  return { kind: 'sleep', opacity: h.slot >= 3 ? Math.min(1, Math.max(0, left / FADE_MS)) : 1 }
}

// A helper Clawd centred on x. Seated, its body ends behind the desk top and
// its laptop's back faces us; standing, it is on its legs on the floor.
function helperSprite(h: Helper, x: number, floor: number, phase: Phase, t: number, i: number): string {
  const isStanding = phase.kind === 'walk'
  const failed = h.status === 'failed'
  const body = failed ? CLAY_LO : CLAY
  const lift = phase.kind === 'party' && !failed ? 7 * Math.abs(Math.sin(Math.PI * phase.p * 4)) : 0
  const bob = isStanding ? 1.5 * Math.abs(Math.sin(t * 9)) : h.status === 'running' && phase.kind === 'seat' ? wave(t + i * 0.3, 0.8) : 0
  const top = (isStanding ? floor - 34 : floor - 46) - lift - bob
  const typing = phase.kind === 'seat' && h.status === 'running'
  const beat = typing ? Math.floor(t / 0.2 + i) % 2 : 0
  const eyeY = top + (h.status === 'waiting' ? 5 : 7)
  const eyes =
    phase.kind === 'party' && !failed
      ? `<rect x="${x - 9}" y="${top + 8}" width="6" height="2" fill="${INK}"/><rect x="${x + 3}" y="${top + 8}" width="6" height="2" fill="${INK}"/>`
      : failed
        ? `<rect x="${x - 8}" y="${top + 9}" width="5" height="1.5" fill="${INK}"/><rect x="${x + 3}" y="${top + 9}" width="5" height="1.5" fill="${INK}"/>`
        : `<rect x="${x - 8}" y="${eyeY}" width="4" height="6" fill="${INK}"/><rect x="${x + 4}" y="${eyeY}" width="4" height="6" fill="${INK}"/>
           <rect x="${x - 8}" y="${eyeY}" width="1.5" height="1.5" fill="#fff"/><rect x="${x + 4}" y="${eyeY}" width="1.5" height="1.5" fill="#fff"/>`
  const arms =
    phase.kind === 'party' && !failed
      ? `<rect x="${x - 21}" y="${top - 6}" width="6" height="10" fill="${body}"/><rect x="${x + 15}" y="${top - 6}" width="6" height="10" fill="${body}"/>`
      : typing
        ? `<rect x="${x - 20}" y="${floor - 26 - (beat ? 3 : 0)}" width="7" height="6" fill="${body}"/><rect x="${x + 13}" y="${floor - 26 - (beat ? 0 : 3)}" width="7" height="6" fill="${body}"/>`
        : `<rect x="${x - 20}" y="${top + 6}" width="6" height="7" fill="${body}"/><rect x="${x + 14}" y="${top + 6}" width="6" height="7" fill="${body}"/>`
  const legs = isStanding
    ? [-11, -4, 3, 9]
        .map((dx, k) => `<rect x="${x + dx}" y="${floor - 10 + (k % 2 === phase.step ? -2 : 0)}" width="3" height="${10 - (k % 2 === phase.step ? -2 : 0)}" fill="${body}"/>`)
        .join('')
    : ''
  const laptop =
    phase.kind === 'seat' || phase.kind === 'party'
      ? `<rect x="${x - 10}" y="${floor - 31}" width="20" height="11" fill="#403e39"/><rect x="${x - 10}" y="${floor - 31}" width="20" height="1.5" fill="#5c5952"/>
         <g opacity="${typing ? f(0.55 + 0.45 * wave(t + i, 1.6)) : 0.35}">${logo(x, floor - 25, 7)}</g>`
      : ''
  const confetti =
    phase.kind === 'party' && !failed
      ? [0, 1, 2, 3, 4, 5]
          .map(k => {
            const a = (k / 6) * 2 * Math.PI + phase.p * 3
            const r = 8 + 22 * phase.p
            const c = [CLAY, '#f0c060', '#9ccf7a', '#8fb3e0'][k % 4] ?? CLAY
            return `<rect x="${f(x + r * Math.cos(a))}" y="${f(top - 4 + r * Math.sin(a) * 0.7)}" width="3" height="3" fill="${c}" opacity="${f(1 - phase.p)}"/>`
          })
          .join('') + `<text class="hmark" x="${x}" y="${top - 10}" fill="#9ccf7a" text-anchor="middle">✓</text>`
      : phase.kind === 'party'
        ? `<text class="hmark" x="${x}" y="${top - 6}" fill="#e06c5a" text-anchor="middle">✗</text>`
        : h.status === 'waiting' && phase.kind === 'seat'
          ? `<text class="hmark" x="${x + 14}" y="${top - 2}" fill="#f0c060">…</text>`
          : ''

  return `<g class="pix">
   ${legs}
   <rect x="${x - 16}" y="${top - 1}" width="32" height="26" fill="${OUT}"/>
   <rect x="${x - 15}" y="${top}" width="30" height="24" fill="${body}"/>
   <rect x="${x - 15}" y="${top}" width="30" height="3" fill="${CLAY_HI}"/>
   ${eyes}${arms}
  </g>${laptop}${confetti}`
}

// A team member asleep at its desk under a blanket: head down, eyes shut,
// laptop closed, breathing slowly under rising z's. `settle` runs 0 to 1 as a
// finished helper sinks down, closes its laptop and pulls the blanket up;
// at 1 it is a sleeper like any other. `back` is drawn behind the desk,
// `front` (the blanket hanging over the desk's edge, the z's) in front of it.
const BLANKET = '#8fb3e0'
const BLANKET_LO = '#6f93c4'
const BLANKET_HI = '#b7d0ef'
function sleepyClawd(x: number, floor: number, t: number, i: number, settle = 1): { back: string; front: string } {
  const e = ease(settle)
  const breathe = 1.5 * wave(t + i * 1.3, 4) * e
  const top = floor - 46 + 10 * e + breathe
  const lidH = 11 - 8 * e
  // The blanket rises from the desk's edge to the sleeper's shoulders.
  const blanketTop = floor - 10 + (top + 12 - (floor - 10)) * e
  const blanketH = floor - 6 - blanketTop
  const stripes = [0.35, 0.7]
    .map(k => `<rect x="${x - 19}" y="${f(blanketTop + blanketH * k)}" width="38" height="2" fill="${BLANKET_LO}"/>`)
    .join('')
  const zs =
    settle >= 1
      ? ['z', 'z', 'Z']
          .map((z, k) => {
            const p = saw(t - k * 1.2 - i * 0.8, 3.6)
            return `<text class="hz" x="${f(x + 12 + k * 5 + 5 * p)}" y="${f(top - 4 - k * 6 - 10 * p)}" opacity="${f(fade(p, 0.3, 0.8))}">${z}</text>`
          })
          .join('')
      : ''
  const back = `<g class="pix">
   <rect x="${x - 16}" y="${f(top - 1)}" width="32" height="26" fill="${OUT}"/>
   <rect x="${x - 15}" y="${f(top)}" width="30" height="24" fill="${CLAY}"/>
   <rect x="${x - 15}" y="${f(top)}" width="30" height="3" fill="${CLAY_HI}"/>
   <rect x="${x - 10}" y="${f(top + 10)}" width="6" height="2" fill="${INK}"/><rect x="${x + 4}" y="${f(top + 10)}" width="6" height="2" fill="${INK}"/>
   <rect x="${x - 12}" y="${f(top + 13)}" width="3" height="2" fill="#f0a48c"/><rect x="${x + 9}" y="${f(top + 13)}" width="3" height="2" fill="#f0a48c"/>
  </g>
  <rect x="${x - 10}" y="${f(floor - 20 - lidH)}" width="20" height="${f(lidH)}" fill="#403e39"/><rect x="${x - 10}" y="${f(floor - 20 - lidH)}" width="20" height="1.5" fill="#5c5952"/>`
  const front = `<g class="pix" opacity="${f(Math.min(1, settle * 4))}">
   <rect x="${x - 20}" y="${f(blanketTop - 1)}" width="40" height="${f(blanketH + 1)}" fill="${BLANKET_LO}"/>
   <rect x="${x - 19}" y="${f(blanketTop)}" width="38" height="${f(blanketH)}" fill="${BLANKET}"/>
   <rect x="${x - 19}" y="${f(blanketTop)}" width="38" height="3" fill="${BLANKET_HI}"/>
   ${stripes}
   <rect x="${x - 19}" y="${floor - 8}" width="38" height="2" fill="${BLANKET_LO}"/>
  </g>${zs}`
  return { back, front }
}

// A speech bubble with a helper's task above its head.
function bubble(x: number, top: number, text: string): string {
  const s = clip(text, 14)
  const w = Math.round(s.length * 3.7 + 8)
  const left = Math.min(158 - w, Math.max(-10, x - w / 2))
  return `<rect x="${f(left)}" y="${top - 16}" width="${w}" height="11" fill="#e8e2d4"/>
  <rect x="${f(x - 2)}" y="${top - 5}" width="4" height="3" fill="#e8e2d4"/>
  <text class="bub" x="${f(left + 4)}" y="${top - 8}">${xml(s)}</text>`
}

function teamRoom(team: Team, t: number, nowMs: number, isWorking: boolean, live: boolean): string {
  const placed = team.rows.filter(h => h.slot >= 0 && h.slot < SEAT_COUNT)
  const phases = new Map(placed.map(h => [h.id, phaseOf(h, nowMs, live)]))
  const phase = (h: Helper): Phase => phases.get(h.id) ?? { kind: 'hidden' }
  // How present the back row is: fully while a helper works or sleeps there,
  // fading with the last back-row sleeper as it leaves the board.
  const backOpacity = Math.max(
    0,
    ...placed
      .filter(h => h.slot >= 3)
      .map(h => {
        const ph = phase(h)
        return ph.kind === 'hidden' ? (h.doneAt === undefined ? 1 : 0) : ph.kind === 'sleep' ? ph.opacity : 1
      }),
  )
  const deskRows = backOpacity > 0 ? [[3, 4], [0, 1, 2]] : [[0, 1, 2]]

  // Each row back to front: who sits at the desk, the desk, then anything
  // in front of it (a blanket hanging over the edge, z's).
  let room = ''
  for (const row of deskRows) {
    let rowSvg = ''
    for (const slot of row) {
      const seat = SEATS[slot]
      if (seat === undefined) {
        continue
      }
      // A working helper owns its desk from the moment it starts; before it
      // walks in, the desk stands empty. Otherwise the latest finished
      // helper there celebrates, tucks in and sleeps; a free front desk has
      // a team member asleep at it.
      const active = placed.find(h => h.slot === slot && h.doneAt === undefined)
      const finished = placed
        .filter(h => h.slot === slot && h.doneAt !== undefined)
        .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))[0]
      let back = ''
      let front = ''
      let opacity = 1
      if (active !== undefined) {
        const ph = phase(active)
        if (ph.kind === 'seat') {
          back = helperSprite(active, seat.x, seat.y, ph, t, slot)
        }
      } else if (finished !== undefined) {
        const ph = phase(finished)
        if (ph.kind === 'party' || ph.kind === 'seat') {
          back = helperSprite(finished, seat.x, seat.y, ph, t, slot)
        } else if (ph.kind === 'tuck' || ph.kind === 'sleep') {
          const z = sleepyClawd(seat.x, seat.y, t, slot, ph.kind === 'tuck' ? ph.p : 1)
          back = z.back
          front = z.front
          opacity = ph.kind === 'sleep' ? ph.opacity : 1
        } else if (slot < 3) {
          const z = sleepyClawd(seat.x, seat.y, t, slot)
          back = z.back
          front = z.front
        }
      } else if (slot < 3) {
        const z = sleepyClawd(seat.x, seat.y, t, slot)
        back = z.back
        front = z.front
      }
      const who = `${back}<g class="pix">${desk(seat.x, seat.y)}</g>${front}`
      rowSvg += opacity < 1 ? `<g opacity="${f(opacity)}">${who}</g>` : who
    }
    room += row[0] !== undefined && row[0] >= 3 && backOpacity < 1 ? `<g opacity="${f(backOpacity)}">${rowSvg}</g>` : rowSvg
  }
  // Walkers pass in front of everything.
  for (const h of placed) {
    const ph = phases.get(h.id)
    if (ph?.kind === 'walk') {
      room += helperSprite(h, ph.x, ph.floor, ph, t, h.slot)
    }
  }
  // One running helper at a time says what it is on, taking turns every 3 s.
  const talkers = placed.filter(h => h.status === 'running' && phases.get(h.id)?.kind === 'seat')
  const talker = talkers[Math.floor(nowMs / 3000) % Math.max(1, talkers.length)]
  if (talker !== undefined && live) {
    const seat = SEATS[talker.slot]
    if (seat !== undefined) {
      room += bubble(seat.x, seat.y - 48, talker.label)
    }
  }

  return `<svg x="${LEFT_SLOT.x}" y="${LEFT_SLOT.y}" width="${LEFT_SLOT.width}" height="${LEFT_SLOT.height}" viewBox="-12 -190 174 386" preserveAspectRatio="xMidYMax meet">
 ${wallClock(130, -50, nowMs)}
 <ellipse class="floor" cx="75" cy="194" rx="92" ry="4"/>
 <g class="pix">${plant(141, 194, t, isWorking)}</g>
 ${room}
</svg>`
}

// A mini Clawd icon for a board row, 20 wide.
function miniClawd(x: number, y: number, status: Helper['status'], t: number, i: number): string {
  const isRunning = status === 'running'
  const beat = isRunning ? Math.floor(t / 0.2 + i) % 2 : 0
  const bob = isRunning ? f(-1 * wave(t + i * 0.3, 0.8)) : '0'
  const eyes =
    status === 'running' || status === 'waiting'
      ? `<rect x="${x + 6}" y="${y + (status === 'waiting' ? 2 : 3)}" width="2" height="3" fill="${INK}"/><rect x="${x + 12}" y="${y + (status === 'waiting' ? 2 : 3)}" width="2" height="3" fill="${INK}"/>`
      : `<rect x="${x + 5}" y="${y + 4}" width="4" height="1" fill="${INK}"/><rect x="${x + 11}" y="${y + 4}" width="4" height="1" fill="${INK}"/>`
  const body = status === 'failed' ? CLAY_LO : CLAY
  const arms = isRunning
    ? `<rect x="${x + 1}" y="${y + 7 - beat}" width="3" height="3" fill="${body}"/><rect x="${x + 16}" y="${y + 6 + beat}" width="3" height="3" fill="${body}"/>`
    : `<rect x="${x + 1}" y="${y + 5}" width="3" height="3" fill="${body}"/><rect x="${x + 16}" y="${y + 5}" width="3" height="3" fill="${body}"/>`
  const laptop = isRunning
    ? `<rect x="${x + 5}" y="${y + 9}" width="10" height="5" fill="#403e39"/><rect x="${x + 8}" y="${y + 11}" width="4" height="1" fill="${CLAY}" opacity="${f(0.5 + 0.5 * wave(t + i, 1.6))}"/>`
    : ''

  return `<g transform="translate(0 ${bob})">
   <rect x="${x + 3}" y="${y - 1}" width="14" height="11" fill="${OUT}"/>
   <rect x="${x + 4}" y="${y}" width="12" height="9" fill="${body}"/>
   ${eyes}${arms}
   <rect x="${x + 5}" y="${y + 10}" width="2" height="3" fill="${body}"/><rect x="${x + 13}" y="${y + 10}" width="2" height="3" fill="${body}"/>
  </g>${laptop}`
}

const STATUS_LOOK: Record<Helper['status'], { color: string; word: string }> = {
  running: { color: CLAY, word: 'working' },
  waiting: { color: '#f0c060', word: 'waiting' },
  done: { color: '#9ccf7a', word: 'done' },
  failed: { color: '#e06c5a', word: 'stopped' },
}
const STATUS_ORDER: Record<Helper['status'], number> = { running: 0, waiting: 1, done: 2, failed: 3 }

// The team board: a row per helper (label, live activity, type, status,
// timer, tool calls), then the session's totals.
function teamBoard(team: Team, t: number, nowMs: number): string {
  const W = 150
  const ROW = 32
  const shown = team.rows.slice(0, TEAM_ROWS)
  const extra = team.rows.length - shown.length
  const busy = team.rows.filter(r => r.status === 'running').length
  const bodyH = shown.length === 0 ? 20 : shown.length * (ROW + 2)
  const footY = 16 + bodyH + (extra > 0 ? 10 : 0)
  const height = footY + 14
  const title = busy > 0 ? `clawd team · ${busy} working` : 'clawd team · asleep'
  const live = team.rows.filter(r => r.doneAt === undefined).reduce((sum, r) => sum + (nowMs - r.since), 0)
  const s = team.stats
  const foot = `${s.launched} launched · ${s.done} done${s.failed > 0 ? ` · ${s.failed} stopped` : ''} · ${duration(s.workedMs + live)}`

  const rows =
    shown.length === 0
      ? `<rect x="4" y="16" width="${W - 8}" height="18" fill="#1a1917"/>
  <text class="tkind" x="10" y="27" fill="#8b877f">The team is asleep. zz</text>`
      : shown
          .map((r, i) => {
            const y = 16 + i * (ROW + 2)
            const look = STATUS_LOOK[r.status]
            const mark =
              r.status === 'running'
                ? (SPINNER[Math.floor(t / 0.2 + i) % SPINNER.length] ?? '✻')
                : r.status === 'waiting'
                  ? '…'
                  : r.status === 'done'
                    ? '✓'
                    : '✗'
            const took = clock2((r.doneAt ?? nowMs) - r.since)
            const shimmer =
              r.status === 'running'
                ? `<rect x="${f(28 + (W - 50) * saw(t + i * 0.4, 1.8))}" y="${y + ROW - 1}" width="14" height="1" fill="${CLAY}" opacity=".8"/>`
                : ''
            return `<rect x="4" y="${y}" width="${W - 8}" height="${ROW}" fill="#1a1917"/>
  ${miniClawd(6, y + 10, r.status, t, i)}
  <g clip-path="url(#tclip)">
   <text class="tlabel" x="28" y="${y + 9}">${xml(clip(r.label, 27))}</text>
   <text class="tact" x="28" y="${y + 18}">${xml(clip(r.activity, 30))}</text>
   <text class="tkind" x="28" y="${y + 27}" fill="${look.color}">${mark} ${xml(clip(r.kind, 14))} · ${took} · ${r.tools} tools</text>
  </g>
  ${shimmer}`
          })
          .join('')
  const more = extra > 0 ? `<text class="tkind" x="8" y="${16 + bodyH + 7}" fill="#8b877f">+${extra} more on the team</text>` : ''

  return `<svg x="${TEAM_SLOT.x}" y="${TEAM_SLOT.y}" width="${TEAM_SLOT.width}" height="${TEAM_SLOT.height}" viewBox="0 0 ${W + 4} ${height + 4}" preserveAspectRatio="xMidYMin meet">
 <defs><clipPath id="tclip"><rect x="26" y="0" width="${W - 32}" height="${height}"/></clipPath></defs>
 <g class="pix">
  <rect x="4" y="4" width="${W}" height="${height}" fill="#000" opacity=".22"/>
  <rect x="0" y="0" width="${W}" height="${height}" fill="#3a3834"/>
  <rect x="0" y="0" width="${W}" height="12" fill="#4a4740"/>
  <rect x="0" y="0" width="${W}" height="2" fill="#5c5952"/>
  <rect x="6" y="4" width="4" height="4" fill="#e06c5a"/><rect x="13" y="4" width="4" height="4" fill="#f0c060"/><rect x="20" y="4" width="4" height="4" fill="#9ccf7a"/>
  <text class="ttl" x="32" y="9">${title}</text>
  ${rows}
  ${more}
  <rect x="4" y="${footY - 1}" width="${W - 8}" height="1" fill="#5c5952"/>
  <text class="tkind" x="6" y="${footY + 8}" fill="#a8a296">${xml(clip(foot, 40))}</text>
 </g>
</svg>`
}

// A paper flying across the window between main Clawd's desk and a seat:
// out with the task when a helper starts, back with a check when it is done.
function paperAt(from: { x: number; y: number }, to: { x: number; y: number }, p: number, isBack: boolean): string {
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
  const x = from.x + (to.x - from.x) * e
  const y = from.y + (to.y - from.y) * e - 24 * Math.sin(Math.PI * p)
  const face = isBack
    ? `<rect x="-7" y="-9" width="14" height="18" fill="#e8e2d4"/><rect x="-7" y="-9" width="14" height="3" fill="#9ccf7a"/>
       <text class="pmark" x="0" y="5" text-anchor="middle" fill="#5a8a3a">✓</text>`
    : `<rect x="-7" y="-9" width="14" height="18" fill="#f2efe8"/><rect x="-7" y="-9" width="14" height="3" fill="${CLAY}"/>
       <rect x="-4" y="-3" width="8" height="1.5" fill="#a8a296"/><rect x="-4" y="0" width="6" height="1.5" fill="#a8a296"/><rect x="-4" y="3" width="8" height="1.5" fill="#a8a296"/>`
  return `<svg x="${f(x)}%" y="${f(y)}%" width="64" height="64" viewBox="-20 -20 40 40">
 <g transform="rotate(${f(-20 + 40 * Math.sin(Math.PI * 2 * p))})"><rect x="-6" y="-8" width="14" height="18" fill="#000" opacity=".2"/>${face}</g>
</svg>`
}

function handOffs(team: Team, nowMs: number, live: boolean): string {
  if (!live) {
    return ''
  }
  let out = ''
  for (const h of team.rows) {
    const seat = seatPct(h.slot < 0 ? 0 : h.slot)
    const a = nowMs - h.since
    if (a >= 0 && a < PAPER_MS) {
      out += paperAt(MAIN_DESK, seat, a / PAPER_MS, false)
    }
    const end = finishedAt(h)
    if (end !== undefined && h.status === 'done') {
      const d = nowMs - end - PAPER_BACK_AT
      if (d >= 0 && d < PAPER_MS) {
        out += paperAt(seat, MAIN_DESK, d / PAPER_MS, true)
      }
    }
  }
  return out
}

function leftStrip(team: Team, t: number, nowMs: number, isWorking: boolean, live: boolean): string {
  return teamRoom(team, t, nowMs, isWorking, live) + teamBoard(team, t, nowMs)
}

function frame(isWorking: boolean, surface: keyof typeof SLOT, t: number, nowMs: number, team: Team = EMPTY_TEAM, live = true): string {
  const slot = SLOT[surface]

  const sky = STARS.map(
    s => `<rect class="star" x="${s.x}" y="${s.y}" width="${s.s}" height="${s.s}" opacity="${f(0.15 + 0.85 * wave(t + s.d, 4))}"/>`,
  ).join('')

  const steam = [0, 1.3]
    .map((d, i) => {
      const p = saw(t - d, 2.6)
      return `<rect x="${137 + i * 6}" y="${f(126 - i * 4 - 16 * p)}" width="3" height="6" fill="#a8a296" opacity="${f(fade(p, 0.4, 0.6))}"/>`
    })
    .join('')

  const floatY = -5 * wave(t, 6)
  const bodY = isWorking ? -3 * wave(t, 0.8) : 2 * wave(t, 4)
  const beat = Math.floor(t / 0.2) % 2

  const eyes = isWorking
    ? `<g transform="translate(${f(-4 + 8 * wave(t, 2.4))} 0)"><rect x="46" y="72" width="10" height="18" fill="${INK}"/><rect x="84" y="72" width="10" height="18" fill="${INK}"/>
       <rect x="47" y="73" width="3" height="4" fill="#fff"/><rect x="85" y="73" width="3" height="4" fill="#fff"/></g>`
    : saw(t, 9) >= 0.8 && saw(t, 9) < 0.92
      ? `<rect x="42" y="82" width="16" height="4" fill="${INK}"/><rect x="84" y="74" width="10" height="14" fill="${INK}"/><rect x="85" y="75" width="3" height="3" fill="#fff"/>`
      : `<rect x="42" y="82" width="16" height="4" fill="${INK}"/><rect x="82" y="82" width="16" height="4" fill="${INK}"/>`

  const arms = isWorking
    ? `<g transform="translate(0 ${beat ? -5 : 0})"><rect x="-2" y="96" width="26" height="18" fill="${OUT}"/><rect x="0" y="98" width="22" height="14" fill="${CLAY}"/></g>
       <g transform="translate(0 ${beat ? 0 : -5})"><rect x="116" y="96" width="26" height="18" fill="${OUT}"/><rect x="118" y="98" width="22" height="14" fill="${CLAY}"/></g>`
    : `<rect x="-2" y="80" width="24" height="24" fill="${OUT}"/><rect x="0" y="82" width="20" height="20" fill="${CLAY}"/>
       <rect x="118" y="80" width="24" height="24" fill="${OUT}"/><rect x="120" y="82" width="20" height="20" fill="${CLAY}"/>`

  const progress = 0.05 + 0.95 * Math.min(1, saw(t, 4) / 0.9)
  const term = isWorking
    ? `<g clip-path="url(#scr)"><g transform="translate(0 ${f(-90 * saw(t, 4))})">${CODE}</g></g>
       <rect x="6" y="-98" width="128" height="20" fill="#201f1c"/>
       <text class="status" x="10" y="-86">${SPINNER[Math.floor(t / 0.2) % SPINNER.length] ?? '✻'}</text>
       <text class="status" x="20" y="-86">Working${'.'.repeat(Math.floor(t / 0.4) % 4)}</text>
       <rect class="track" x="10" y="-82" width="120" height="2"/><rect x="10" y="-82" width="${f(120 * progress)}" height="2" fill="${CLAY}"/>`
    : `<text x="10" y="-148" class="prompt">&gt;</text>${saw(t, 1.2) < 0.5 ? `<rect x="20" y="-155" width="6" height="9" fill="${CLAY}"/>` : ''}
       <text class="hint" x="10" y="-86">? for shortcuts</text>`

  const pulse = 0.55 + 0.45 * wave(t, 1.6)
  const extras = isWorking
    ? `<g opacity="${f(pulse)}" transform="rotate(${f(360 * saw(t, 3))} 70 40)">${logo(70, 40, 30)}</g>` +
      GLYPHS.map((g, i) => {
        const p = saw(t - i * 0.45, 2.8)
        return `<text class="glyph" x="${28 + ((i * 19) % 80)}" y="${f(92 - 150 * p)}" opacity="${f(fade(p, 0.15, 0.95))}">${xml(g)}</text>`
      }).join('')
    : ['z', 'z', 'Z']
        .map((z, i) => {
          const p = saw(t - i * 1.2, 3.6)
          return `<text class="zz" x="${f(116 + i * 13 + 8 * p)}" y="${f(56 - i * 15 - 18 * p)}" opacity="${f(fade(p, 0.3, 0.85))}">${z}</text>`
        })
        .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<style>
.bg{fill:#f0eee6}.dot{fill:#dcd7ca}.star{fill:${CLAY}}.sky{opacity:.3}.sun{fill:${CLAY};opacity:.07}.wood{fill:#a8724f}.woodlo{fill:#8a5a3c}.grain{fill:#946140}.track{fill:#f2efe8;opacity:.15}.floor{fill:#1f1e1b;opacity:.12}
@media (prefers-color-scheme: dark){.bg{fill:#232220}.dot{fill:#34322e}.star{fill:#f2efe8}.sky{opacity:.6}.sun{opacity:.06}.wood{fill:#6e4a33}.woodlo{fill:#553826}.grain{fill:#5f3f2b}.floor{fill:#000;opacity:.3}}
.pix{shape-rendering:crispEdges}
.prompt{font:bold 10px monospace;fill:#9ccf7a}
.hint,.ttl{font:7px monospace;fill:#8b877f}
.status{font:bold 8px monospace;fill:${CLAY}}
.glyph{font:bold 10px monospace;fill:${CLAY}}
.zz{font:bold 13px monospace;fill:${CLAY}}
.tlabel{font:7px monospace;fill:#e8e2d4}
.tkind{font:6px monospace}
.tact{font:6.5px monospace;fill:#cfcabf}
.hmark{font:bold 11px monospace}
.hz{font:bold 8px monospace;fill:${CLAY}}
.bub{font:6px monospace;fill:#1f1e1b}
.pmark{font:bold 10px monospace}
</style>
<defs>
<pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><rect class="dot" x="18" y="18" width="3" height="3"/></pattern>
<radialGradient id="glw"><stop offset="0" stop-color="${CLAY}" stop-opacity=".5"/><stop offset="1" stop-color="${CLAY}" stop-opacity="0"/></radialGradient>
<clipPath id="scr"><rect x="6" y="-160" width="128" height="62"/></clipPath>
</defs>
<rect class="bg" width="100%" height="100%"/>
<rect width="100%" height="100%" fill="url(#g)"/>
<svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMaxYMin slice">
 <g class="sun" transform="rotate(${f(360 * saw(t, 140))} 1450 140)">${logo(1450, 140, 520)}</g>
 <g class="sky">${sky}</g>
</svg>
${surface === 'desktop' ? leftStrip(team, t, nowMs, isWorking, live) : ''}
<svg x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" viewBox="-12 -190 174 386" preserveAspectRatio="xMidYMax meet">
 <ellipse cx="70" cy="110" rx="80" ry="60" fill="url(#glw)" opacity="${isWorking ? f(0.4 + 0.2 * wave(t, 1.6)) : 0.15}"/>
 <g class="pix" transform="translate(0 ${f(floatY)})">
  <rect x="4" y="-174" width="140" height="102" fill="#000" opacity=".22"/>
  <rect x="0" y="-178" width="140" height="102" fill="#3a3834"/>
  <rect x="0" y="-178" width="140" height="12" fill="#4a4740"/>
  <rect x="0" y="-178" width="140" height="2" fill="#5c5952"/>
  <rect x="6" y="-174" width="4" height="4" fill="#e06c5a"/><rect x="13" y="-174" width="4" height="4" fill="#f0c060"/><rect x="20" y="-174" width="4" height="4" fill="#9ccf7a"/>
  <text class="ttl" x="58" y="-169">claude</text>
  <rect x="6" y="-160" width="128" height="82" fill="#1a1917"/>
  ${term}
 </g>
 ${extras}
 <ellipse class="floor" cx="75" cy="194" rx="92" ry="4"/>
 <g class="pix">
  <g transform="translate(0 ${f(bodY)})">
   <rect x="28" y="118" width="14" height="34" fill="${OUT}"/><rect x="48" y="118" width="14" height="34" fill="${OUT}"/><rect x="78" y="118" width="14" height="34" fill="${OUT}"/><rect x="98" y="118" width="14" height="34" fill="${OUT}"/>
   <rect x="30" y="120" width="10" height="32" fill="${CLAY}"/><rect x="50" y="120" width="10" height="32" fill="${CLAY}"/><rect x="80" y="120" width="10" height="32" fill="${CLAY}"/><rect x="100" y="120" width="10" height="32" fill="${CLAY}"/>
   <rect x="18" y="58" width="104" height="66" fill="${OUT}"/>
   <rect x="20" y="60" width="100" height="62" fill="${CLAY}"/>
   <rect x="20" y="60" width="100" height="6" fill="${CLAY_HI}"/>
   <rect x="20" y="60" width="4" height="30" fill="${CLAY_HI}"/>
   <rect x="20" y="114" width="100" height="8" fill="${CLAY_LO}"/>
   ${isWorking ? `<rect x="20" y="66" width="100" height="30" fill="#ffe2d4" opacity="${f(0.1 + 0.12 * wave(t, 1.6))}"/>` : ''}
   <rect x="30" y="90" width="10" height="4" fill="#f0a48c"/><rect x="100" y="90" width="10" height="4" fill="#f0a48c"/>
   ${eyes}
   ${arms}
  </g>
  <rect x="25" y="92" width="90" height="4" fill="#000" opacity=".18"/>
  <rect x="25" y="96" width="90" height="26" fill="#403e39"/>
  <rect x="25" y="122" width="90" height="26" fill="#363430"/>
  <rect x="25" y="96" width="90" height="3" fill="#5c5952"/>
  <rect x="25" y="96" width="3" height="52" fill="#4a4740"/>
  ${isWorking ? `<ellipse cx="70" cy="122" rx="20" ry="16" fill="url(#glw)" opacity="${f(pulse)}"/>` : ''}
  <g opacity="${isWorking ? f(pulse) : 0.35}">${logo(70, 122, 24)}</g>
  <rect x="12" y="146" width="116" height="6" fill="#4a4740"/><rect x="12" y="146" width="116" height="2" fill="#5c5952"/>
  <rect x="134" y="136" width="14" height="16" fill="#e8e2d4"/><rect x="148" y="140" width="4" height="8" fill="#e8e2d4"/><rect x="134" y="136" width="14" height="3" fill="#6b4a33"/><rect x="134" y="143" width="14" height="3" fill="${CLAY}"/>
  ${steam}
  <rect x="-10" y="152" width="172" height="9" class="wood"/>
  <rect x="-2" y="155" width="34" height="1" class="grain"/><rect x="48" y="157" width="44" height="1" class="grain"/><rect x="108" y="155" width="40" height="1" class="grain"/>
  <rect x="-10" y="161" width="172" height="3" class="woodlo"/>
  <rect x="-4" y="164" width="8" height="30" class="woodlo"/>
  <rect x="146" y="164" width="8" height="30" class="woodlo"/>
  <rect x="96" y="164" width="50" height="14" class="wood"/><rect x="96" y="176" width="50" height="2" class="woodlo"/><rect x="116" y="169" width="10" height="3" fill="#d9b48f"/>
 </g>
</svg>
${surface === 'desktop' ? handOffs(team, nowMs, live) : ''}
</svg>`
}

// What a helper's tool call means in a few words, for the board.
function describeTool(e: { tool: string }): string {
  const args = e as unknown as Record<string, unknown>
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const base = (path: string) => path.split(/[\\/]/).pop() ?? path
  switch (e.tool) {
    case 'Read':
      return `Reading ${base(s('file_path'))}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${base(s('file_path'))}`
    case 'Write':
      return `Writing ${base(s('file_path'))}`
    case 'NotebookEdit':
      return `Editing ${base(s('notebook_path'))}`
    case 'Bash':
    case 'PowerShell':
      return s('description') || `Running ${s('command')}`
    case 'Grep':
      return `Searching "${s('pattern')}"`
    case 'Glob':
      return `Finding ${s('pattern')}`
    case 'WebFetch':
      return `Fetching ${s('url').replace(/^https?:\/\//, '').split('/')[0] ?? ''}`
    case 'WebSearch':
      return `Searching the web: ${s('query')}`
    case 'Agent':
      return `Delegating: ${s('description')}`
    case 'TodoWrite':
      return 'Updating its to-do list'
    default:
      return e.tool.startsWith('mcp__') ? `Using ${e.tool.split('__').pop() ?? e.tool}` : `Using ${e.tool}`
  }
}

export const register: Register = on => {
  // Mirrors the `working` atom for the timer, which cannot await a read.
  let isWorkingNow = false
  let timer: { cancel: () => void } | undefined
  let ticks = 0
  let isMotionOn = true

  // The team, kept here and published to `teamAtom` for drawing. `listed` are
  // helpers `$.agent.list()` has shown (workflow agents never appear there);
  // `gone` are ones already pruned, so a lingering list row does not return.
  const roster = new Map<string, Helper>()
  const listed = new Set<string>()
  const gone = new Set<string>()
  let stats: TeamStats = { ...EMPTY_TEAM.stats }
  let lastTeam = ''
  let publish: (() => Promise<void>) | undefined
  let pollTeam: (() => Promise<void>) | undefined

  const statusOf = (s: AgentStatus): Helper['status'] =>
    s === 'running' || s === 'pending' ? 'running' : s === 'waiting' || s === 'idle' ? 'waiting' : s === 'completed' ? 'done' : 'failed'
  const isTeammate = (h: Helper) => h.kind.startsWith('teammate')

  // The lowest desk not claimed: a desk frees once its helper has walked out.
  const freeSlot = (now: number) => {
    const used = new Set(
      [...roster.values()].filter(h => h.doneAt === undefined || now - (finishedAt(h) ?? now) < SETTLED_AT).map(h => h.slot),
    )
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (!used.has(i)) {
        return i
      }
    }
    return -1
  }
  const addHelper = (id: string, label: string, kind: string, now: number) => {
    if (roster.has(id) || gone.has(id)) {
      return
    }
    roster.set(id, { id, label, kind, status: 'running', since: now, tools: 0, activity: 'Starting up', slot: freeSlot(now) })
    stats = { ...stats, launched: stats.launched + 1 }
  }
  const finish = (h: Helper, status: 'done' | 'failed', now: number) => {
    if (h.doneAt !== undefined) {
      return
    }
    roster.set(h.id, {
      ...h,
      status,
      doneAt: now,
      activity: status === 'done' ? `Finished in ${clock2(now - h.since)}` : 'Stopped',
    })
    stats = {
      ...stats,
      done: stats.done + (status === 'done' ? 1 : 0),
      failed: stats.failed + (status === 'failed' ? 1 : 0),
      workedMs: stats.workedMs + (now - h.since),
    }
  }

  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    await update($, working, () => false)
    await $.theme.set(LOOK)
    // Clears the debug line an earlier version left in the status bar.
    $.ui.status(undefined)

    await update($, motion, () => isMotionOn)
    await $.command.register({
      name: 'clawd-motion',
      description: 'Turn the Clawd backdrop animation on or off',
      argumentHint: 'on | off',
    })

    // The session's totals outlive a reload of the mod.
    await update($, teamAtom, prev => {
      stats = { ...EMPTY_TEAM.stats, ...(prev?.stats ?? {}) }
      return prev ?? EMPTY_TEAM
    })

    publish = async () => {
      const rows = [...roster.values()].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.since - b.since)
      const value: Team = { rows, stats }
      const key = JSON.stringify(value)
      if (key !== lastTeam) {
        lastTeam = key
        await update($, teamAtom, () => value)
      }
    }
    pollTeam = async () => {
      let agents: AgentInfo[] = []
      try {
        agents = await $.agent.list()
      } catch {
        agents = []
      }
      const now = await $.clock.now()
      const seen = new Set<string>()
      for (const a of agents) {
        if (gone.has(a.id)) {
          continue
        }
        seen.add(a.id)
        const status = statusOf(a.status)
        if (!roster.has(a.id)) {
          // One that ended before the mod saw it never joins the board.
          if (status === 'done' || status === 'failed') {
            gone.add(a.id)
            continue
          }
          const kind = a.teammateId !== undefined ? `teammate ${a.name ?? ''}`.trim() : a.type
          addHelper(a.id, a.description || a.name || a.type, kind, now)
        }
        listed.add(a.id)
        const h = roster.get(a.id)
        if (h === undefined) {
          continue
        }
        if (status === 'done' || status === 'failed') {
          finish(h, status, now)
        } else if (h.doneAt === undefined && h.status !== status) {
          roster.set(h.id, { ...h, status })
        }
      }
      for (const h of [...roster.values()]) {
        // The list drops an ended agent soon after it ends.
        if (h.doneAt === undefined && listed.has(h.id) && !seen.has(h.id)) {
          finish(h, 'done', now)
        }
        // A finished helper stays on the board for 20 s after it fell asleep.
        const end = finishedAt(roster.get(h.id) ?? h)
        if (end !== undefined && now - end > SETTLED_AT + PRUNE_AFTER) {
          roster.delete(h.id)
          gone.add(h.id)
        }
      }
      await publish?.()
    }
    void pollTeam()

    timer?.cancel()
    timer = $.clock.every(WORKING_FRAME_MS, () => {
      ticks += 1
      // The team asks for the session's agents once a second.
      if (ticks % 10 === 0) {
        void pollTeam?.()
      }
      if (!isMotionOn) {
        // One still frame every 30 s, so the wall clock keeps the time.
        if (ticks % Math.round(30_000 / WORKING_FRAME_MS) === 0) {
          void update($, tick, n => (n + 1) % 1_000_000)
        }
        return
      }
      if (isWorkingNow || ticks % Math.round(IDLE_FRAME_MS / WORKING_FRAME_MS) === 0) {
        void update($, tick, n => (n + 1) % 1_000_000)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'clawd-motion' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    isMotionOn = arg === 'on' ? true : arg === 'off' ? false : !isMotionOn
    await update($, motion, () => isMotionOn)

    return { text: `Clawd animation ${isMotionOn ? 'on' : 'off'}.` }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.agentId !== undefined) {
      const kind = e.workflow !== undefined ? 'workflow' : e.isTeammate ? 'teammate' : e.subagentType
      const label = e.description || (e.workflow !== undefined ? `workflow agent ${e.workflow.agentIndex}` : e.subagentType)
      addHelper(result.agentId, label, kind, await $.clock.now())
      await publish?.()
    }

    return result
  })

  // Live activity: what each helper's latest tool call is doing.
  on('tool.call', async ($, e, next) => {
    const h = e.agentId === undefined ? undefined : roster.get(e.agentId)
    if (h !== undefined && h.doneAt === undefined) {
      roster.set(h.id, { ...h, tools: h.tools + 1, activity: describeTool(e), status: 'running' })
      await publish?.()
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorkingNow = true
      await update($, working, () => true)
    } else {
      const h = roster.get(e.agentId)
      if (h !== undefined && h.doneAt === undefined && h.status !== 'running') {
        roster.set(h.id, { ...h, status: 'running' })
        await publish?.()
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      isWorkingNow = false
      await update($, working, () => false)
    } else {
      const h = roster.get(e.agentId)
      if (h !== undefined && h.doneAt === undefined) {
        // A teammate goes idle between turns; any other helper is finished.
        if (isTeammate(h)) {
          roster.set(h.id, { ...h, status: 'waiting', activity: 'Waiting for a message' })
        } else {
          finish(h, e.reason === 'answer' ? 'done' : 'failed', await $.clock.now())
        }
        await publish?.()
      }
    }

    return result
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== PLUGIN || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const isWorking = await read($, working)
    // Read only to redraw on every tick; the frame itself follows the clock.
    await read($, tick)
    const nowMs = await $.clock.now()
    const live = await read($, motion)
    // With motion off every draw is the same frame, at a fixed moment.
    const t = live ? nowMs / 1000 : 1
    const team = await read($, teamAtom)
    const busy = team.rows.filter(h => h.status === 'running').length

    return (
      <Svg
        source={frame(isWorking, e.surface, t, nowMs, team, live)}
        alt={
          (isWorking ? "Claude's pixel mascot typing at its laptop while it works" : "Claude's pixel mascot dozing at its desk") +
          (busy > 0 ? `, with ${busy} helper${busy === 1 ? '' : 's'} at work` : '')
        }
        isInteractive
      />
    )
  })
}
