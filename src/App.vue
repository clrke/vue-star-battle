<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from './stores/game'
import { useProgressionStore } from './stores/progression'
import Board from './components/Board.vue'
import GeneratePanel from './components/GeneratePanel.vue'
import LevelHud from './components/LevelHud.vue'
import HintBox from './components/HintBox.vue'
import StatsModal from './components/StatsModal.vue'
import { puzzles } from './data/puzzles'
import { useDarkMode } from './composables/useDarkMode'
import { preGenerate } from './composables/useGenerator'

const game        = useGameStore()
const progression = useProgressionStore()
const { currentPuzzle, isSolved, canUndo, canRedo } = storeToRefs(game)
const { currentSize } = storeToRefs(progression)

// Only show static puzzles matching the player's current level — they don't
// get to pick smaller / larger boards.
const availablePuzzles = computed(() =>
  puzzles.filter(p => p.n === currentSize.value),
)

const { darkMode, toggleDark } = useDarkMode()
const showStats = ref(false)

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
  // Warm up the generator for the player's current level/size
  preGenerate(progression.currentSize)
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
        <small class="hint-desktop">Left-click = ★ &nbsp;·&nbsp; Right-click = mark dot &nbsp;·&nbsp; Ctrl+Z = undo</small>
        <small class="hint-touch">Single tap = mark dot &nbsp;·&nbsp; Double tap = ★</small>
      </p>
    </header>

    <LevelHud />

    <div class="hud-actions">
      <button class="hud-action-btn" @click="showStats = true">📊 Stats</button>
      <button class="hud-action-btn" :aria-label="darkMode ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleDark">
        {{ darkMode ? '☀️' : '🌙' }}
      </button>
    </div>

    <div class="puzzle-controls">
      <nav v-if="availablePuzzles.length" class="puzzle-nav">
        <button
          v-for="p in availablePuzzles"
          :key="p.id"
          class="puzzle-btn"
          :class="{ 'puzzle-btn--active': currentPuzzle.id === p.id }"
          @click="game.initBoard(p)"
        >
          {{ p.title }}
        </button>
      </nav>

      <div v-if="availablePuzzles.length" class="controls-divider"><span>or generate</span></div>

      <GeneratePanel />
    </div>

    <main class="app-main">
      <Board />
    </main>

    <HintBox />

    <StatsModal v-if="showStats" @close="showStats = false" />

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
  gap: 14px;
  padding: 14px 10px 20px;
}

@media (max-width: 480px) {
  .app { gap: 10px; padding: 8px 6px 16px; }
  .app-title { font-size: 1.4rem !important; }
  .app-subtitle { font-size: 0.78rem; line-height: 1.35; }
}

.app-header { text-align: center; }
.app-title {
  font-size: clamp(1.5rem, 5vw, 2.2rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  color: var(--text);
}
.app-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
}
.app-subtitle small {
  display: inline-block;
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Show desktop hint for fine-pointer (mouse), touch hint for coarse-pointer */
.hint-touch   { display: none; }
@media (pointer: coarse) {
  .hint-desktop { display: none; }
  .hint-touch   { display: inline-block; }
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
  border: 2px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text);
  transition: all 120ms ease;
}
.puzzle-btn:hover { border-color: var(--border-strong); background: var(--bg-subtle); }
.puzzle-btn--active {
  border-color: var(--text); background: var(--text); color: var(--bg);
}

.controls-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(360px, 90vw);
  color: var(--text-muted);
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
  background: var(--border);
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
  border: 2px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
  transition: all 120ms ease;
}
.footer-btn:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); }
.footer-btn:disabled { opacity: 0.35; cursor: default; }

.footer-btn--reset { border-color: var(--border); color: var(--text-muted); }

.footer-btn--hint { border-color: var(--amber); color: var(--amber); }
.footer-btn--hint:hover:not(:disabled) {
  background: var(--bg-subtle); border-color: var(--amber); color: var(--amber);
}

.hud-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.hud-action-btn {
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
  padding: 4px 8px;
  border-radius: 6px;
  transition: color 120ms ease, background 120ms ease;
}
.hud-action-btn:hover {
  color: var(--text);
  background: var(--bg-subtle);
}
</style>
