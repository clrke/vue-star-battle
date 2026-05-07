<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import Cell from './Cell.vue'
import type { BorderEdges } from '../types/puzzle'

const game = useGameStore()
const { currentPuzzle, displayCellStates, violations, isSolved, hintCell, lastHint, starCount } = storeToRefs(game)

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
  background: #e0e0e0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: #1a1a2e;
  transition: width 200ms ease, background 400ms ease;
}

.progress--done .progress-fill {
  background: #27ae60;
}

.progress-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #666;
  min-width: 4ch;
  text-align: right;
  transition: color 400ms ease;
}

.progress--done .progress-label {
  color: #27ae60;
}

/* Board */
.board {
  display: grid;
  width: min(95vw, 75vh, 560px);
  height: min(95vw, 75vh, 560px);
  border: 3px solid #222;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  overflow: hidden;
  transition: box-shadow 0.4s ease;
  /* Block pinch zoom on the board itself */
  touch-action: manipulation;
}

.board--solved {
  box-shadow: 0 0 0 4px #27ae60, 0 4px 24px rgba(39, 174, 96, 0.35);
}

.solved-banner {
  font-size: 1.5rem;
  font-weight: 700;
  color: #27ae60;
  letter-spacing: 0.02em;
}

.solved-enter-active { transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.solved-enter-from   { opacity: 0; transform: scale(0.6); }
</style>
