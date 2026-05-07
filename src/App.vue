<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from './stores/game'
import { useProgressionStore } from './stores/progression'
import Board from './components/Board.vue'
import LevelHud from './components/LevelHud.vue'
import HintBox from './components/HintBox.vue'
import StatsModal from './components/StatsModal.vue'
import { puzzles } from './data/puzzles'
import { useDarkMode } from './composables/useDarkMode'
import { preGenerate, useGenerator } from './composables/useGenerator'
import { useSound } from './composables/useSound'

const game        = useGameStore()
const progression = useProgressionStore()
const { isSolved, canUndo, canRedo } = storeToRefs(game)
const { potentialXp, nextHintCost } = storeToRefs(progression)

const { status: genStatus, generate } = useGenerator()
const isGenerating = computed(() => genStatus.value === 'generating')

const { darkMode, toggleDark } = useDarkMode()
const { muted, toggleMute } = useSound()
const showStats = ref(false)

// Live XP preview on the Hint button: shows what the player will earn
// if they solve right now, minus the cost of the next hint they're about
// to request. Color-codes green/muted/red to signal whether they're in
// positive, zero, or level-down territory.
const hintButtonXp = computed(() => {
  // potentialXp is what they'd earn if they solved NOW (before this hint)
  // subtract nextHintCost to show what it'll be AFTER clicking Hint
  const after = (potentialXp.value ?? 0) - nextHintCost.value
  return after
})
const hintXpClass = computed(() => {
  const v = hintButtonXp.value
  if (v > 0)  return 'hint-xp--pos'
  if (v === 0) return 'hint-xp--zero'
  return 'hint-xp--neg'
})

async function onNext() {
  if (isGenerating.value) return
  try {
    const puzzle = await generate(progression.currentSize)
    game.initBoard(puzzle)
  } catch { /* failure surfaces via genStatus; user can re-click */ }
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { game.clearHint(); return }
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
  // The store boots with puzzles[0] (a 4×4). If the player has levelled past
  // that, swap in a size-appropriate puzzle so they aren't stuck on the wrong
  // grid — bundled match preferred, generated fallback otherwise.
  if (game.currentPuzzle.n !== progression.currentSize) {
    const bundled = puzzles.find(p => p.n === progression.currentSize)
    if (bundled) game.initBoard(bundled)
    else void onNext()
  }
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
      <button class="hud-action-btn" :aria-label="muted ? 'Unmute sounds' : 'Mute sounds'" @click="toggleMute">
        {{ muted ? '🔇' : '🔊' }}
      </button>
      <button class="hud-action-btn" :aria-label="darkMode ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleDark">
        {{ darkMode ? '☀️' : '🌙' }}
      </button>
    </div>

    <main class="app-main">
      <Board />
    </main>

    <HintBox />

    <StatsModal v-if="showStats" @close="showStats = false" />

    <footer class="app-footer">
      <button v-if="!isSolved" class="footer-btn" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="game.undo()">↩ Undo</button>
      <button v-if="!isSolved" class="footer-btn" title="Redo (Ctrl+Shift+Z)" :disabled="!canRedo" @click="game.redo()">↪ Redo</button>
      <button v-if="!isSolved" class="footer-btn footer-btn--reset" title="Reset puzzle" @click="game.reset">Reset</button>
      <button
        v-if="isSolved"
        class="footer-btn footer-btn--next"
        :disabled="isGenerating"
        @click="onNext"
      >
        <span v-if="isGenerating" class="footer-btn__inner">
          <span class="footer-spinner" />
          Generating…
        </span>
        <span v-else>Next ➜</span>
      </button>
      <button
        v-else
        class="footer-btn footer-btn--hint"
        @click="game.showHint()"
      >
        Hint
        <span class="hint-xp-badge" :class="hintXpClass">
          {{ hintButtonXp >= 0 ? '+' : '' }}{{ hintButtonXp }} XP
        </span>
      </button>
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

.footer-btn--hint {
  border-color: var(--amber);
  color: var(--amber);
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.footer-btn--hint:hover:not(:disabled) {
  background: var(--bg-subtle); border-color: var(--amber); color: var(--amber);
}

/* XP preview badge inside the Hint button */
.hint-xp-badge {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  opacity: 0.9;
  transition: color 200ms ease;
}
.hint-xp--pos  { color: #27ae60; }
.hint-xp--zero { color: var(--text-muted); }
.hint-xp--neg  { color: var(--red); }

/* Solved-state CTA: replaces Hint with a prominent green Next button. */
.footer-btn--next {
  border-color: #27ae60;
  background: #27ae60;
  color: #fff;
  box-shadow: 0 2px 10px rgba(39, 174, 96, 0.35);
  animation: next-pulse 1.6s ease-in-out infinite;
}
.footer-btn--next:hover:not(:disabled) {
  background: #229954;
  border-color: #229954;
}
.footer-btn--next:disabled {
  animation: none;
  box-shadow: none;
}
.footer-btn__inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.footer-spinner {
  display: inline-block;
  width: 12px; height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes next-pulse {
  0%, 100% { box-shadow: 0 2px 10px rgba(39, 174, 96, 0.35); }
  50%      { box-shadow: 0 2px 18px rgba(39, 174, 96, 0.65); }
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
