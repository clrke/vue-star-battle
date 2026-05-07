<script setup lang="ts">
import { useGameStore } from './stores/game'
import Board from './components/Board.vue'
import { puzzles } from './data/puzzles'
import { storeToRefs } from 'pinia'

const game = useGameStore()
const { currentPuzzle, isSolved } = storeToRefs(game)
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1 class="app-title">★ Star Battle</h1>
      <p class="app-subtitle">Place one star in every row, column, and region — no two stars may touch.</p>
    </header>

    <nav class="puzzle-nav">
      <button
        v-for="p in puzzles"
        :key="p.id"
        class="puzzle-btn"
        :class="{ 'puzzle-btn--active': currentPuzzle.id === p.id }"
        @click="game.initBoard(p)"
      >
        {{ p.title }}
      </button>
    </nav>

    <main class="app-main">
      <Board />
    </main>

    <footer class="app-footer">
      <button class="reset-btn" @click="game.reset">Reset</button>
      <button class="hint-btn" :disabled="isSolved" @click="game.showHint()">Hint</button>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 24px 16px 32px;
}

.app-header {
  text-align: center;
}

.app-title {
  font-size: clamp(1.6rem, 5vw, 2.4rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0 0 6px;
  color: #1a1a2e;
}

.app-subtitle {
  margin: 0;
  font-size: 0.875rem;
  color: #555;
  max-width: 36ch;
}

.puzzle-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.puzzle-btn {
  padding: 6px 16px;
  border-radius: 999px;
  border: 2px solid #ddd;
  background: #fff;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  color: #444;
  transition: all 120ms ease;
}

.puzzle-btn:hover {
  border-color: #aaa;
  background: #f5f5f5;
}

.puzzle-btn--active {
  border-color: #1a1a2e;
  background: #1a1a2e;
  color: #fff;
}

.app-main {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
}

.app-footer {
  display: flex;
  gap: 12px;
}

.reset-btn {
  padding: 8px 24px;
  border-radius: 8px;
  border: 2px solid #ccc;
  background: #fff;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  color: #555;
  transition: all 120ms ease;
}

.reset-btn:hover {
  border-color: #999;
  color: #222;
}

.hint-btn {
  padding: 8px 24px;
  border-radius: 8px;
  border: 2px solid #f39c12;
  background: #fff;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  color: #f39c12;
  transition: all 120ms ease;
}

.hint-btn:hover:not(:disabled) {
  background: #fef9f0;
  border-color: #e67e22;
  color: #e67e22;
}

.hint-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
