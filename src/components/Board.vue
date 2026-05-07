<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import { useProgressionStore } from '../stores/progression'
import Cell from './Cell.vue'
import type { BorderEdges } from '../types/puzzle'

const game        = useGameStore()
const progression = useProgressionStore()
const {
  currentPuzzle, displayCellStates, violations, isSolved,
  hintCell, lastHint, starCount, lastSolve, currentHintStep,
} = storeToRefs(game)

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

watch(isSolved, (solved) => {
  if (solved) {
    // Freeze on the final time captured at solve
    if (lastSolve.value?.elapsedMs != null) elapsedMs.value = lastSolve.value.elapsedMs
    stopTimer()
  } else {
    startTimer()
  }
})

watch(currentPuzzle, () => {
  // New puzzle → reset display and resume ticking
  elapsedMs.value = progression.getElapsedMs()
  startTimer()
})

onMounted(() => { if (!isSolved.value) startTimer() })
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
const hintAction = computed(() =>
  lastHint.value && (lastHint.value.action === 'place-mark' || lastHint.value.action === 'place-star')
    ? lastHint.value.action
    : null,
)
</script>

<template>
  <div class="board-wrap">
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
    </div>

    <!-- Grid -->
    <div
      class="board"
      :style="{
        gridTemplateColumns: `repeat(${n}, 1fr)`,
        gridTemplateRows:    `repeat(${n}, 1fr)`,
      }"
      :class="{ 'board--solved': isSolved }"
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
          @toggle-star="game.toggleStar(r - 1, c - 1)"
          @toggle-mark="game.toggleMark(r - 1, c - 1)"
        />
      </template>
    </div>

    <Transition name="solved">
      <div v-if="isSolved" class="solved-banner">🎉 Solved!</div>
    </Transition>
  </div>
</template>

<style scoped>
.board-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  container-type: inline-size;
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
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--green);
  letter-spacing: 0.02em;
}

.solved-enter-active { transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.solved-enter-from   { opacity: 0; transform: scale(0.6); }
</style>
