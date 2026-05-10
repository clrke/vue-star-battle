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
```

---

## References

- [Star Battle Rules and Info — GMPuzzles](https://www.gmpuzzles.com/blog/star-battle-rules-and-info/)
- [Star Battle — Puzzle Wiki](https://www.puzzles.wiki/wiki/Star_Battle)
- [Queens — LinkedIn](https://www.linkedin.com/help/linkedin/answer/a6269510)
