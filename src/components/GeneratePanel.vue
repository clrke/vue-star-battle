<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGenerator } from '../composables/useGenerator'
import { useGameStore } from '../stores/game'
import { useProgressionStore } from '../stores/progression'
import { unlockRequirement } from '../types/progression'

const ALL_SIZES = [4, 5, 6, 7, 8, 10, 12] as const

const game        = useGameStore()
const progression = useProgressionStore()
const { maxN, perSize } = storeToRefs(progression)

// Default to the highest unlocked size
const selectedN = ref(maxN.value)
watch(maxN, (m) => { if (selectedN.value > m) selectedN.value = m })

const sizes = computed(() =>
  ALL_SIZES.map(n => ({ n, locked: n > maxN.value })),
)

const { status, elapsed, generate, cancel } = useGenerator()
const isGenerating = computed(() => status.value === 'generating')
const hasFailed    = computed(() => status.value === 'failed')

async function onGenerate() {
  if (isGenerating.value) { cancel(); return }
  try {
    const puzzle = await generate(selectedN.value)
    game.initBoard(puzzle)
  } catch {
    /* failed status handled in template */
  }
}

const lockReasonFor = (n: number) => {
  const req = unlockRequirement(n)
  if (!req) return `${n}×${n} puzzle`
  const have = perSize.value[req.previousSize]?.solved ?? 0
  return `Solve ${req.requiredSolves - have} more ${req.previousSize}×${req.previousSize} ` +
    `puzzle${req.requiredSolves - have === 1 ? '' : 's'} to unlock ${n}×${n}.`
}
</script>

<template>
  <div class="gen-panel">
    <div class="gen-sizes">
      <button
        v-for="{ n, locked } in sizes"
        :key="n"
        class="size-btn"
        :class="{
          'size-btn--active': selectedN === n,
          'size-btn--locked': locked,
        }"
        :disabled="isGenerating || locked"
        :title="locked ? lockReasonFor(n) : `${n}×${n} puzzle`"
        @click="selectedN = n"
      >
        {{ n }}×{{ n }}
        <span v-if="locked" class="lock-icon">🔒</span>
      </button>
    </div>

    <button
      class="gen-btn"
      :class="{ 'gen-btn--cancel': isGenerating }"
      @click="onGenerate"
    >
      <span v-if="!isGenerating">Generate {{ selectedN }}×{{ selectedN }}</span>
      <span v-else class="gen-btn__inner">
        <span class="spinner" />
        {{ (elapsed / 1000).toFixed(1) }}s — Cancel
      </span>
    </button>

    <Transition name="fade">
      <p v-if="hasFailed" class="gen-error">
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

.gen-sizes { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }

.size-btn {
  padding: 5px 13px;
  border-radius: 999px;
  border: 2px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-muted);
  transition: all 120ms ease;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.size-btn:hover:not(:disabled):not(.size-btn--active) {
  border-color: var(--border-strong);
  background: var(--bg-subtle);
}

.size-btn:disabled { opacity: 0.45; cursor: default; }

.size-btn--active {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
}

.size-btn--locked {
  background: var(--bg-subtle);
  color: var(--text-muted);
  cursor: not-allowed;
}

.lock-icon { font-size: 0.7em; }

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
