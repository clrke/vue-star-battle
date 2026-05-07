<script setup lang="ts">
import { ref } from 'vue'
import { useGenerator } from '../composables/useGenerator'
import { useGameStore } from '../stores/game'

const sizes = [5, 6, 7, 8]
const selectedN = ref(6)

const game  = useGameStore()
const { status, elapsed, generate, cancel } = useGenerator()

const isGenerating = () => status.value === 'generating'
const hasFailed    = () => status.value === 'failed'

async function onGenerate() {
  if (isGenerating()) { cancel(); return }
  try {
    const puzzle = await generate(selectedN.value)
    game.initBoard(puzzle)
  } catch {
    // status is already 'failed'
  }
}
</script>

<template>
  <div class="gen-panel">
    <div class="gen-sizes">
      <button
        v-for="n in sizes"
        :key="n"
        class="size-btn"
        :class="{ 'size-btn--active': selectedN === n }"
        :disabled="isGenerating()"
        @click="selectedN = n"
      >
        {{ n }}×{{ n }}
      </button>
    </div>

    <button
      class="gen-btn"
      :class="{ 'gen-btn--cancel': isGenerating() }"
      @click="onGenerate"
    >
      <span v-if="!isGenerating()">Generate</span>
      <span v-else class="gen-btn__inner">
        <span class="spinner" />
        {{ (elapsed / 1000).toFixed(1) }}s — Cancel
      </span>
    </button>

    <Transition name="fade">
      <p v-if="hasFailed()" class="gen-error">
        Generation timed out — try again or pick a smaller size.
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

.gen-sizes {
  display: flex;
  gap: 6px;
}

.size-btn {
  padding: 5px 13px;
  border-radius: 999px;
  border: 2px solid #ddd;
  background: #fff;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  color: #555;
  transition: all 120ms ease;
}

.size-btn:hover:not(:disabled):not(.size-btn--active) {
  border-color: #aaa;
  background: #f5f5f5;
}

.size-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.size-btn--active {
  border-color: #1a1a2e;
  background: #1a1a2e;
  color: #fff;
}

.gen-btn {
  padding: 8px 24px;
  border-radius: 8px;
  border: 2px solid #2980b9;
  background: #2980b9;
  color: #fff;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 700;
  transition: all 120ms ease;
  min-width: 140px;
}

.gen-btn:hover:not(.gen-btn--cancel) {
  background: #1a6ca0;
  border-color: #1a6ca0;
}

.gen-btn--cancel {
  background: #e74c3c;
  border-color: #e74c3c;
}

.gen-btn--cancel:hover {
  background: #c0392b;
  border-color: #c0392b;
}

.gen-btn__inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* CSS spinner */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.gen-error {
  margin: 0;
  font-size: 0.8rem;
  color: #e74c3c;
  text-align: center;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from,  .fade-leave-to      { opacity: 0; }
</style>
