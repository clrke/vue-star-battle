# ★ Star Battle

A polished Vue 3 implementation of **Star Battle**, the logic puzzle invented by Hans Eendebak for the 2003 World Puzzle Championship.

**[▶ Play it live →](https://clrke.github.io/vue-star-battle/)**

You may know it as **Queens** (LinkedIn), **Kings** (The Almanac iOS), or **Two Not Touch** (The New York Times). All are rebrands of the same 1★ Star Battle variant.

---

## Rules

Given an *N×N* grid divided into *N* irregular colored regions:

1. Place exactly **one star** in every row.
2. Place exactly **one star** in every column.
3. Place exactly **one star** in every region.
4. **No two stars may touch** — not horizontally, vertically, or diagonally.

---

## Features

**Core gameplay**
- Boards from 4×4 up to 10×10, unlocked progressively as you level up
- Left-click / single tap = place/remove a star; right-click / double tap = dot marker
- Auto-marks: cells eliminated by an existing star dim automatically
- Violation highlights: conflicting stars flash red
- Undo / Redo (Ctrl+Z / Ctrl+Shift+Z), Reset

**Progression & XP**
- XP awarded on each solve; penalty for hint use; can level up or down
- Grid size and puzzle difficulty (lookahead tier) scale with your level
- Streak tracking: consecutive hint-free solves

**Puzzle generation**
- Exact-cover backtracking solver validates every generated puzzle has a unique solution
- Web Worker–based generator keeps the UI responsive
- Pre-generation warms the cache so "Next" is instant
- Bundled hand-authored puzzles for early levels; generator takes over beyond those

**Hint system**
- Multi-step hints with highlighted cells and plain-English reasoning
- Techniques: forced placement, region confinement, pair/triple confinement, deep lookahead process-of-elimination
- Hints cost XP; badge on the button shows exact cost before you commit

**Daily puzzle**
- One shared seeded puzzle per calendar day
- Solved state persists across tabs/refreshes; resets at UTC midnight
- Pre-generated in the background on page load

**Stats**
- Per-grid-size solve count, best time, and average
- Total hints used, total time, total solves
- Personal best detection on each solve

**UX**
- Dark mode toggle (persisted)
- Sound effects with mute toggle (persisted)
- Responsive layout — works on mobile (touch) and desktop
- Auto-opens "How to Play" on first visit
- Share button on solve card (Web Share API with fallback copy)
- Confetti on solve

---

## Solver videos (YouTube Shorts)

`npm run video` renders an exactly **60-second**, vertical **1080×1920 · 60 fps** MP4 of a depth-first search solving a freshly generated puzzle, with a fully procedural soundtrack — no browser, no screen recording, one command.

```bash
npm run video -- --size 8 --seed 42 --out output/demo.mp4           # render a video (+ output/demo.json sidecar)
npm run video -- --puzzle output/demo.json --out output/again.mp4   # re-render a saved puzzle exactly
npm run video -- --seed 42 --still 0,5,20 --out output/stills        # PNG frames only (fast preview)
npm run video:daily                                                 # dated render for the upload cron
```

Options: `--size 6..10` (default: 9/10 at 50/50 %), `--seed`, `--number N` (puzzle # in the header), `--duration S` (exact video length, default 60 — the search speeds up or slows down to fill it), `--fps`, `--no-audio`, `--preview` (also write a 720p `-preview.mp4` small enough for chat). Requires Node ≥ 20 and `ffmpeg` (libx264) on `PATH`.

How a video is made (`video/`):

| Stage | File | What it does |
|---|---|---|
| Puzzle | `select.ts` | Seeded generator + "drama" filter — enough dead ends to be interesting, not so many it blurs |
| Solver | `trace.ts` | Row-order DFS with forward checking, recorded as place / dead-end / backtrack events |
| Pacing | `timeline.ts` | 120 BPM grid: slow start, accelerating ramp, cruise at exactly the speed that fills the duration, slowed final run, solve on the beat |
| Picture | `render/` | Skia canvas frames as a pure function of time (any frame renders alone) |
| Sound | `score.ts`, `audio/` | Cue list → procedural synth: mallet note per star (pitch = depth), sparkle on new depth records, soft bonk on dead ends, lo-fi beat + I–V–vi–IV pad, riser → impact on the solve, chime per verified row, confetti pops |
| Encode | `encode.ts` | Raw RGBA frames piped into ffmpeg (H.264, BT.709) + AAC soundtrack |

Every render writes a JSON sidecar (grid, seeds, stats) next to the MP4. `--puzzle <sidecar>` reproduces a video exactly; `--seed` alone usually does too, but the generator's fallback phase is time-budgeted, so a seed can yield a different puzzle on a slower or faster machine.

---

## Tech stack

| | |
|---|---|
| Framework | Vue 3 (Composition API, `<script setup>`) |
| Build | Vite 8 |
| State | Pinia |
| Language | TypeScript 6 |
| Tests | Vitest |
| Deploy | GitHub Pages via GitHub Actions |

---

## Development

```bash
npm install
npm run dev        # dev server at http://localhost:5173/vue-star-battle/
npm run test       # run tests once
npm run test:watch # watch mode
npm run build      # production build
npm run simulate   # run the puzzle generator simulation script
npm run video      # render a solver video (see "Solver videos" above)
```

---

## References

- [Star Battle Rules and Info — GMPuzzles](https://www.gmpuzzles.com/blog/star-battle-rules-and-info/)
- [Star Battle — Puzzle Wiki](https://www.puzzles.wiki/wiki/Star_Battle)
- [Queens — LinkedIn](https://www.linkedin.com/help/linkedin/answer/a6269510)
