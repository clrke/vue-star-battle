<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGenerator } from '../composables/useGenerator'
import { useGameStore } from '../stores/game'
import { useProgressionStore } from '../stores/progression'

const game        = useGameStore()
const progression = useProgressionStore()
const { currentSize } = storeToRefs(progression)

const { status, elapsed, generate, cancel } = useGenerator()
const isGenerating = computed(() => status.value === 'generating')
const hasFailed    = computed(() => status.value === 'failed')

async function onGenerate() {
  if (isGenerating.value) { cancel(); return }
  try {
    const puzzle = await generate(currentSize.value)
    game.initBoard(puzzle)
  } catch {
    /* failed status handled in template */
  }
}
</script>

<template>
  <div class="gen-panel">
    <button
      class="gen-btn"
      :class="{ 'gen-btn--cancel': isGenerating }"
      @click="onGenerate"
    >
      <span v-if="!isGenerating">Generate {{ currentSize }}×{{ currentSize }}</span>
      <span v-else class="gen-btn__inner">
        <span class="spinner" />
        {{ (elapsed / 1000).toFixed(1) }}s — Cancel
      </span>
    </button>

    <Transition name="fade">
      <p v-if="hasFailed" class="gen-error">
        Generation timed out — try again.
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.gen-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.gen-btn {
  padding: 8px 24px;
  border-radius: 8px;
  border: 2px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 700;
  transition: all 120ms ease;
  min-width: 200px;
}

.gen-btn:hover:not(.gen-btn--cancel) { background: var(--accent-dark); border-color: var(--accent-dark); }

.gen-btn--cancel { background: var(--red); border-color: var(--red); }
.gen-btn--cancel:hover { filter: brightness(0.9); }

.gen-btn__inner { display: flex; align-items: center; justify-content: center; gap: 8px; }

.spinner {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.gen-error {
  margin: 0; font-size: 0.8rem; color: var(--red); text-align: center;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
</style>
