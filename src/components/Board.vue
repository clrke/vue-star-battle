<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import Cell from './Cell.vue'
import type { BorderEdges } from '../types/puzzle'

const game = useGameStore()
const { currentPuzzle, cellStates, violations, isSolved, hintCell } = storeToRefs(game)

const n = computed(() => currentPuzzle.value.n)

function getBorders(row: number, col: number): BorderEdges {
  const grid = currentPuzzle.value.grid
  const size = n.value
  const rid = grid[row][col]
  return {
    top:    row === 0        || grid[row - 1][col] !== rid,
    right:  col === size - 1 || grid[row][col + 1] !== rid,
    bottom: row === size - 1 || grid[row + 1][col] !== rid,
    left:   col === 0        || grid[row][col - 1] !== rid,
  }
}

function isViolated(row: number, col: number): boolean {
  return violations.value.has(`${row},${col}`)
}

function isHint(row: number, col: number): boolean {
  const h = hintCell.value
  return h !== null && h[0] === row && h[1] === col
}
</script>

<template>
  <div class="board-wrap">
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
          :state="cellStates[r - 1][c - 1]"
          :borders="getBorders(r - 1, c - 1)"
          :is-violated="isViolated(r - 1, c - 1)"
          :is-hint="isHint(r - 1, c - 1)"
          @click="game.cycleCell(r - 1, c - 1)"
          @contextmenu="game.cycleCell(r - 1, c - 1)"
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
  gap: 16px;
  container-type: inline-size;
}

.board {
  display: grid;
  width: min(90vw, 90vh, 560px);
  height: min(90vw, 90vh, 560px);
  border: 3px solid #222;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  overflow: hidden;
  transition: box-shadow 0.4s ease;
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
