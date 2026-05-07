<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from './stores/game'
import Board from './components/Board.vue'
import { puzzles } from './data/puzzles'

const game = useGameStore()
const { currentPuzzle, isSolved, canUndo, canRedo } = storeToRefs(game)

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  if (e.key === 'z') {
    e.preventDefault()
    if (e.shiftKey) game.redo()
    else            game.undo()
  }
  if (e.key === 'y') {
    e.preventDefault()
    game.redo()
  }
}

onMounted(()  => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1 class="app-title">★ Star Battle</h1>
      <p class="app-subtitle">
        Place one star in every row, column &amp; region — no two stars may touch.<br>
        <small>Left-click = ★ &nbsp;·&nbsp; Right-click = mark dot &nbsp;·&nbsp; Ctrl+Z = undo</small>
      </p>
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
      <button class="footer-btn" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="game.undo()">↩ Undo</button>
      <button class="footer-btn" title="Redo (Ctrl+Shift+Z)" :disabled="!canRedo" @click="game.redo()">↪ Redo</button>
      <button class="footer-btn footer-btn--reset" title="Reset puzzle" @click="game.reset">Reset</button>
      <button class="footer-btn footer-btn--hint" :disabled="isSolved" @click="game.showHint()">Hint</button>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 20px 16px 28px;
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
  line-height: 1.6;
}

.app-subtitle small {
  font-size: 0.78rem;
  color: #888;
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

.puzzle-btn:hover { border-color: #aaa; background: #f5f5f5; }

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
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

/* Shared button base */
.footer-btn {
  padding: 8px 20px;
  border-radius: 8px;
  border: 2px solid #ddd;
  background: #fff;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  color: #555;
  transition: all 120ms ease;
}

.footer-btn:hover:not(:disabled) { border-color: #aaa; color: #222; }

.footer-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Variants */
.footer-btn--reset {
  border-color: #ccc;
  color: #555;
}

.footer-btn--hint {
  border-color: #f39c12;
  color: #f39c12;
}

.footer-btn--hint:hover:not(:disabled) {
  background: #fef9f0;
  border-color: #e67e22;
  color: #e67e22;
}
</style>
