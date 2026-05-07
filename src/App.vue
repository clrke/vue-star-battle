<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from './stores/game'
import { useProgressionStore } from './stores/progression'
import Board from './components/Board.vue'
import GeneratePanel from './components/GeneratePanel.vue'
import LevelHud from './components/LevelHud.vue'
import HintBox from './components/HintBox.vue'
import { puzzles } from './data/puzzles'

const game        = useGameStore()
const progression = useProgressionStore()
const { currentPuzzle, isSolved, canUndo, canRedo } = storeToRefs(game)

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  if (e.key === 'z') {
    e.preventDefault()
    e.shiftKey ? game.redo() : game.undo()
  }
  if (e.key === 'y') { e.preventDefault(); game.redo() }
}

// Pause progression timer when tab hidden, resume on return
function onVisibility() {
  if (document.hidden) progression.pause()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
})
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

    <LevelHud />

    <div class="puzzle-controls">
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

      <div class="controls-divider"><span>or generate</span></div>

      <GeneratePanel />
    </div>

    <main class="app-main">
      <Board />
    </main>

    <HintBox />

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
  gap: 16px;
  padding: 16px 14px 24px;
}

.app-header { text-align: center; }
.app-title {
  font-size: clamp(1.5rem, 5vw, 2.2rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  color: #1a1a2e;
}
.app-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: #555;
  line-height: 1.5;
}
.app-subtitle small {
  font-size: 0.75rem;
  color: #888;
}

.puzzle-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.puzzle-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.puzzle-btn {
  padding: 5px 14px;
  border-radius: 999px;
  border: 2px solid #ddd;
  background: #fff;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  color: #444;
  transition: all 120ms ease;
}
.puzzle-btn:hover { border-color: #aaa; background: #f5f5f5; }
.puzzle-btn--active {
  border-color: #1a1a2e; background: #1a1a2e; color: #fff;
}

.controls-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(360px, 90vw);
  color: #aaa;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.controls-divider::before,
.controls-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #ddd;
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
.footer-btn:disabled { opacity: 0.35; cursor: default; }

.footer-btn--reset { border-color: #ccc; color: #555; }

.footer-btn--hint { border-color: #f39c12; color: #f39c12; }
.footer-btn--hint:hover:not(:disabled) {
  background: #fef9f0; border-color: #e67e22; color: #e67e22;
}
</style>
