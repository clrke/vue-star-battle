<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import { useProgressionStore } from '../stores/progression'
import Cell from './Cell.vue'
import Confetti from './Confetti.vue'
import type { BorderEdges } from '../types/puzzle'
import { cellShimmerIndex as shimmerIndexLib } from '../lib/shimmer'
import { playStarPlace, playMarkPlace, playSolve, playWrong } from '../composables/useSound'

const game        = useGameStore()
const progression = useProgressionStore()
const {
  currentPuzzle, displayCellStates, violations, completion, isSolved,
  hintCell, lastHint, starCount, lastSolve, currentHintStep,
} = storeToRefs(game)
const { currentSize, perSize } = storeToRefs(progression)

// Personal best for the current grid size — shown as a live target while solving.
const bestTimeMs = computed(() => perSize.value[currentSize.value]?.bestTimeMs ?? null)

// ── Highlight sets from the current hint step ────────────────────────────
const hintRows    = computed(() => new Set(currentHintStep.value?.highlight.rows    ?? []))
const hintCols    = computed(() => new Set(currentHintStep.value?.highlight.cols    ?? []))
const hintRegions = computed(() => new Set(currentHintStep.value?.highlight.regions ?? []))
const hintExtras  = computed(() => {
  const s = new Set<string>()
  for (const [r, c] of currentHintStep.value?.highlight.cells ?? []) s.add(`${r},${c}`)
  return s
})

const inHintRow    = (r: number) => hintRows.value.has(r)
const inHintCol    = (c: number) => hintCols.value.has(c)
const inHintRegion = (r: number, c: number) => hintRegions.value.has(currentPuzzle.value.grid[r][c])
const isHintExtra  = (r: number, c: number) => hintExtras.value.has(`${r},${c}`)

// ── Live session timer ─────────────────────────────────────────────────────
const elapsedMs = ref(progression.getElapsedMs())
let timerId: ReturnType<typeof setInterval> | null = null

function startTimer() {
  if (timerId) return
  elapsedMs.value = progression.getElapsedMs()
  timerId = setInterval(() => { elapsedMs.value = progression.getElapsedMs() }, 500)
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null }
}

onMounted(() => {
  if (!isSolved.value) startTimer()
  // Auto-focus so keyboard navigation works immediately on load
  boardEl.value?.focus({ preventScroll: true })
})
onUnmounted(stopTimer)

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const n = computed(() => currentPuzzle.value.n)

function getBorders(row: number, col: number): BorderEdges {
  const grid = currentPuzzle.value.grid
  const size = n.value
  const rid  = grid[row][col]
  return {
    top:    row === 0        || grid[row - 1][col] !== rid,
    right:  col === size - 1 || grid[row][col + 1] !== rid,
    bottom: row === size - 1 || grid[row + 1][col] !== rid,
    left:   col === 0        || grid[row][col - 1] !== rid,
  }
}

const isViolated  = (row: number, col: number) => violations.value.has(`${row},${col}`)
const isHint      = (row: number, col: number) => {
  const h = hintCell.value
  return h !== null && h[0] === row && h[1] === col
}

// "Complete" = part of any row/column/region that holds its single
// non-violated star. Cells in any complete line get a gold shimmer
// whose phase per cell is the cell's distance from the satisfying star
// (see src/lib/shimmer.ts for the pure math + the property-based tests
// that pin down wave direction and continuity).
const inCompleteLine = (row: number, col: number) =>
  completion.value.rows.has(row) ||
  completion.value.cols.has(col) ||
  completion.value.regions.has(currentPuzzle.value.grid[row][col])

function cellShimmerIndex(row: number, col: number): number {
  return shimmerIndexLib(row, col, currentPuzzle.value.grid, completion.value)
}
const hintAction = computed(() =>
  lastHint.value && (lastHint.value.action === 'place-mark' || lastHint.value.action === 'place-star')
    ? lastHint.value.action
    : null,
)

// ── Confetti ──────────────────────────────────────────────────────────────
const showConfetti = ref(false)

// ── Hover crosshair (mouse only) ──────────────────────────────────────────
// Track which cell the mouse is currently over so we can tint the rest of
// its row and column. Cleared on pointerleave from the board. Cells filter
// to pointerType === 'mouse', and the visual is also gated behind
// `(hover: hover) and (pointer: fine)` in CSS, so touch never shows it.
const hoverCell = ref<{ r: number; c: number } | null>(null)
const inHoverRow = (r: number) => hoverCell.value?.r === r
const inHoverCol = (c: number) => hoverCell.value?.c === c
function onCellHover(r: number, c: number) { hoverCell.value = { r, c } }
function onBoardLeave() { hoverCell.value = null }

// ── Share result ──────────────────────────────────────────────────────────
const shareCopied = ref(false)
let shareTimer: ReturnType<typeof setTimeout> | null = null

async function share() {
  const s = lastSolve.value
  if (!s) return

  const size    = `${n.value}×${n.value}`
  const time    = formatTime(s.elapsedMs)
  const clean   = s.streak >= 1
  const url     = window.location.origin + import.meta.env.BASE_URL
  const isDaily = currentPuzzle.value.id.startsWith('daily-')

  // Build the descriptive body (no URL — passed separately to native share)
  let shareBody = isDaily
    ? `📅 Daily Star Battle ${currentPuzzle.value.title} — solved in ${time}`
    : `⭐ Star Battle — ${size} solved in ${time}`
  if (clean) shareBody += ' · no hints'
  if (s.isPersonalBest) shareBody += ' · 🏆 Personal best!'
  if (s.streak >= 2) shareBody += `\n🔥 ${s.streak} clean in a row`

  if (navigator.share) {
    // Native share: title + text + url as separate fields so share targets
    // (Twitter, Messages, etc.) can handle each appropriately
    try { await navigator.share({ title: 'Star Battle', text: shareBody, url }) }
    catch { /* user cancelled */ }
  } else {
    // Clipboard: include the URL inline so it's a self-contained message
    const text = `${shareBody}\n${url}`
    try {
      await navigator.clipboard.writeText(text)
      if (shareTimer) clearTimeout(shareTimer)
      shareCopied.value = true
      shareTimer = setTimeout(() => { shareCopied.value = false }, 1800)
    } catch { /* clipboard blocked — silently skip */ }
  }
}

// ── Keyboard navigation ────────────────────────────────────────────────────
// The board-wrap div is focusable (tabindex="0"). Arrow keys move the focus
// cursor; Space/Enter toggle ★; D/X toggle dot. Mouse clicks also update the
// cursor so keyboard picks up from wherever the user last clicked.
const boardEl      = ref<HTMLElement | null>(null)
const focusedCell  = ref<{ r: number; c: number } | null>({ r: 0, c: 0 })
// Hide the focus ring until the player first uses an arrow key — prevents
// a distracting blue square at (0,0) for mouse-only users.
const keyboardMode = ref(false)

// Reset to top-left on every new puzzle
watch(currentPuzzle, () => {
  focusedCell.value = { r: 0, c: 0 }
  elapsedMs.value   = progression.getElapsedMs()
  startTimer()
})

// Clear cursor when solved (keyboard is no-op while solved anyway)
watch(isSolved, (solved) => {
  if (solved) {
    if (lastSolve.value?.elapsedMs != null) elapsedMs.value = lastSolve.value.elapsedMs
    stopTimer()
    showConfetti.value = true
    playSolve()
    focusedCell.value = null
  } else {
    showConfetti.value = false
    startTimer()
    focusedCell.value = { r: 0, c: 0 }
  }
})

function onBoardKey(e: KeyboardEvent) {
  if (isSolved.value) return

  // Arrow keys — move the focus cursor
  if (e.key.startsWith('Arrow')) {
    e.preventDefault()
    keyboardMode.value = true    // first arrow key → reveal focus ring
    const sz  = n.value
    const cur = focusedCell.value ?? { r: 0, c: 0 }
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    }
    const [dr, dc] = delta[e.key] ?? [0, 0]
    focusedCell.value = {
      r: Math.max(0, Math.min(sz - 1, cur.r + dr)),
      c: Math.max(0, Math.min(sz - 1, cur.c + dc)),
    }
    return
  }

  const f = focusedCell.value
  if (!f) return

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    onToggleStar(f.r, f.c)
  } else if (e.key === 'd' || e.key === 'D' || e.key === 'x' || e.key === 'X') {
    onToggleMark(f.r, f.c)
  }
}

// Re-focus the board-wrap on pointerdown so keyboard resumes after clicking
// the Stats modal or other UI outside the board.
function onBoardPointerdown() { boardEl.value?.focus({ preventScroll: true }) }

// ── Cell interaction with sound ────────────────────────────────────────────
// Check the state BEFORE calling the store action so we know whether the
// action is a "place" (→ play sound) or a "remove" (→ silent).
// Also syncs the keyboard focus cursor to wherever the player clicked.
function onToggleStar(r: number, c: number) {
  keyboardMode.value = false      // mouse/touch interaction → hide keyboard ring
  focusedCell.value = { r, c }
  const before = displayCellStates.value[r][c]
  game.toggleStar(r, c)
  if (before !== 'star' && before !== 'auto-marked') {
    // After the store updates, check if the placed star is in violation.
    // violations is a Pinia computed — accessing it here recomputes synchronously.
    if (game.violations.has(`${r},${c}`)) playWrong()
    else playStarPlace()
  }
}
function onToggleMark(r: number, c: number) {
  keyboardMode.value = false
  focusedCell.value = { r, c }
  const before = displayCellStates.value[r][c]
  game.toggleMark(r, c)
  // Play only when placing a dot (not toggling off, not a star cell)
  if (before === 'empty') playMarkPlace()
}
</script>

<template>
  <div
    ref="boardEl"
    class="board-wrap"
    tabindex="0"
    role="application"
    aria-label="Star Battle puzzle grid. Use arrow keys to move, Space or Enter to place a star, D or X to mark a cell."
    @keydown="onBoardKey"
    @pointerdown="onBoardPointerdown"
  >
    <!-- Progress bar -->
    <div class="progress" :class="{ 'progress--done': isSolved }">
      <span class="progress-time">⏱ {{ formatTime(elapsedMs) }}</span>
      <div class="progress-track">
        <div
          class="progress-fill"
          :style="{ width: `${Math.min(starCount / n, 1) * 100}%` }"
        />
      </div>
      <span class="progress-label">{{ starCount }} / {{ n }} ★</span>
      <span
        v-if="bestTimeMs !== null && !isSolved"
        class="progress-best"
        title="Your personal best for this grid size"
      >🏆 {{ formatTime(bestTimeMs) }}</span>
    </div>

    <!-- Grid -->
    <div
      class="board"
      :style="{
        gridTemplateColumns: `repeat(${n}, 1fr)`,
        gridTemplateRows:    `repeat(${n}, 1fr)`,
      }"
      :class="{ 'board--solved': isSolved }"
      @pointerleave="onBoardLeave"
    >
      <template v-for="r in n" :key="r">
        <Cell
          v-for="c in n"
          :key="`${r - 1},${c - 1}`"
          :region-id="currentPuzzle.grid[r - 1][c - 1]"
          :state="displayCellStates[r - 1][c - 1]"
          :borders="getBorders(r - 1, c - 1)"
          :is-violated="isViolated(r - 1, c - 1)"
          :is-hint="isHint(r - 1, c - 1)"
          :hint-action="hintAction"
          :in-hint-row="inHintRow(r - 1)"
          :in-hint-col="inHintCol(c - 1)"
          :in-hint-region="inHintRegion(r - 1, c - 1)"
          :is-hint-extra="isHintExtra(r - 1, c - 1)"
          :in-hover-row="inHoverRow(r - 1)"
          :in-hover-col="inHoverCol(c - 1)"
          :is-focused="keyboardMode && focusedCell?.r === r - 1 && focusedCell?.c === c - 1"
          :in-complete-line="inCompleteLine(r - 1, c - 1)"
          :shimmer-index="cellShimmerIndex(r - 1, c - 1)"
          @hover="onCellHover(r - 1, c - 1)"
          @toggle-star="onToggleStar(r - 1, c - 1)"
          @toggle-mark="onToggleMark(r - 1, c - 1)"
        />
      </template>
    </div>

    <Transition name="solved">
      <div v-if="isSolved" class="solved-banner">
        <div class="solved-main">🎉 Solved!</div>
        <div v-if="lastSolve" class="solved-stats">
          <span class="solved-time">{{ formatTime(lastSolve.elapsedMs) }}</span>
          <span class="solved-sep">·</span>
          <span class="solved-xp" :class="lastSolve.gained >= 0 ? 'solved-xp--pos' : 'solved-xp--neg'">
            {{ lastSolve.gained >= 0 ? '+' : '' }}{{ lastSolve.gained }} XP
          </span>
          <template v-if="lastSolve.isPersonalBest">
            <span class="solved-sep">·</span>
            <span class="solved-pb">🏆 Best!</span>
          </template>
        </div>
        <div v-if="lastSolve && lastSolve.streak >= 2" class="solved-streak">🔥 {{ lastSolve.streak }} clean in a row!</div>
        <div v-if="lastSolve?.leveledUp" class="solved-level">⬆ Leveled up!</div>
        <div v-else-if="lastSolve?.leveledDown" class="solved-level solved-level--down">⬇ Level down</div>
        <div class="solved-share">
          <button v-if="!shareCopied" class="share-btn" @click="share">📤 Share</button>
          <span v-else class="share-copied">Copied ✓</span>
        </div>
      </div>
    </Transition>

    <Confetti :active="showConfetti" @done="showConfetti = false" />
  </div>
</template>

<style scoped>
.board-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  container-type: inline-size;
  /* Suppress browser focus outline — we draw our own per-cell ring */
  outline: none;
}

/* Progress bar */
.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(95vw, 90vh, 560px);
}

.progress-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--text);
  transition: width 200ms ease, background 400ms ease;
}

.progress--done .progress-fill {
  background: var(--green);
}

.progress-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-muted);
  min-width: 4ch;
  text-align: right;
  transition: color 400ms ease;
}

.progress-time {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 5ch;
  transition: color 400ms ease;
}

.progress-best {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  white-space: nowrap;
}

.progress--done .progress-label,
.progress--done .progress-time {
  color: var(--green);
}


/* Board */
.board {
  display: grid;
  width: min(95vw, 75vh, 560px);
  height: min(95vw, 75vh, 560px);
  border: 3px solid var(--border-strong);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  overflow: hidden;
  transition: box-shadow 0.4s ease;
  /* Block pinch zoom on the board itself */
  touch-action: manipulation;
}

.board--solved {
  box-shadow: 0 0 0 4px var(--green), 0 4px 24px rgba(39, 174, 96, 0.35);
}

.solved-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.solved-main {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--green);
  letter-spacing: 0.02em;
}

.solved-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.solved-sep { opacity: 0.4; }

.solved-xp--pos { color: var(--green); }
.solved-xp--neg { color: var(--red, #e74c3c); }

.solved-pb { color: var(--gold); }

.solved-streak {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--orange);
}

.solved-level {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--green);
}
.solved-level--down { color: var(--text-muted); }

.solved-share { margin-top: 2px; }

.share-btn {
  background: transparent;
  border: 1.5px solid var(--border);
  border-radius: 6px;
  padding: 4px 14px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.share-btn:hover { border-color: var(--border-strong); color: var(--text); }

.share-copied {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--green);
}

.solved-enter-active { transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.solved-enter-from   { opacity: 0; transform: scale(0.6); }
</style>
