<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'

const game = useGameStore()
const {
  lastHint, currentHintStep, totalHintSteps, hintStepIndex,
  isFirstHintStep, isLastHintStep,
} = storeToRefs(game)

const visible = computed(() => lastHint.value !== null)

const variantClass = computed(() => {
  if (!lastHint.value) return ''
  switch (lastHint.value.category) {
    case 'forced-region':
    case 'forced-row':
    case 'forced-col':       return 'hint--logic'
    case 'mark-adjacent':
    case 'mark-region':
    case 'mark-row':
    case 'mark-col':
    case 'pointing-region-row':
    case 'pointing-region-col':
    case 'claiming-row':
    case 'claiming-col':
    case 'pair-rows':
    case 'pair-cols':
    case 'pair-regions-rows':
    case 'pair-regions-cols':
    case 'triple-rows':
    case 'triple-cols':
    case 'triple-regions-rows':
    case 'triple-regions-cols':
    case 'common-neighbor-region':
    case 'common-neighbor-row':
    case 'common-neighbor-col':
    case 'squeeze-rows':
    case 'squeeze-cols':
    case 'fish-cols':
    case 'fish-rows':          return 'hint--mark'
    case 'fallback':           return 'hint--fallback'
    case 'wrong-mark':
    case 'wrong-star':
    case 'contradiction':    return 'hint--error'
    case 'already-solved':   return 'hint--done'
    default:                 return ''
  }
})

const canApply = computed(() =>
  lastHint.value?.cell != null && lastHint.value.action !== 'none',
)

const applyLabel = computed(() => {
  if (!lastHint.value) return ''
  switch (lastHint.value.action) {
    case 'place-star':  return 'Place ★'
    case 'place-mark':  return 'Place dot'
    case 'remove-mark': return 'Remove dot'
    case 'remove-star': return 'Remove ★'
    default:            return ''
  }
})

const isMultiStep = computed(() => totalHintSteps.value > 1)

function dismiss() { game.clearHint() }
function next()    { game.nextHintStep() }
function prev()    { game.prevHintStep() }
function apply()   { game.applyHint() }
</script>

<template>
  <Transition name="slide-down">
    <div v-if="visible && lastHint && currentHintStep" class="hint-box" :class="variantClass">
      <div class="hint-header">
        <span class="hint-label">
          {{ lastHint.label }}
          <span v-if="isMultiStep" class="hint-step-counter">
            · Step {{ hintStepIndex + 1 }} / {{ totalHintSteps }}
          </span>
        </span>
        <button class="hint-close" @click="dismiss" aria-label="Dismiss hint">×</button>
      </div>

      <p class="hint-reason">{{ currentHintStep.text }}</p>

      <div v-if="isMultiStep" class="hint-progress">
        <span
          v-for="i in totalHintSteps"
          :key="i"
          class="hint-progress-dot"
          :class="{ 'hint-progress-dot--done': i - 1 <= hintStepIndex }"
        />
      </div>

      <div class="hint-actions">
        <button
          v-if="isMultiStep"
          class="hint-btn"
          :disabled="isFirstHintStep"
          @click="prev"
        >← Prev</button>

        <button
          v-if="isMultiStep && !isLastHintStep"
          class="hint-btn hint-btn--primary"
          @click="next"
        >Next →</button>

        <button
          v-if="canApply && (isLastHintStep || !isMultiStep)"
          class="hint-btn hint-btn--primary"
          @click="apply"
        >{{ applyLabel }}</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.hint-box {
  width: min(560px, 92vw);
  border-left: 4px solid var(--accent);
  background: var(--bg-card);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 0.85rem;
  line-height: 1.55;
  position: relative;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.hint--logic    { border-color: var(--text);   background: var(--bg-subtle); }
.hint--mark     { border-color: var(--accent);  background: var(--bg-card); }
.hint--fallback { border-color: var(--amber);   background: var(--bg-card); }
.hint--error    { border-color: var(--red);     background: var(--bg-card); }
.hint--done     { border-color: var(--green);   background: var(--bg-card); }

.hint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  gap: 8px;
}

.hint-label {
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text);
}
.hint-step-counter {
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}
.hint--mark     .hint-label { color: var(--accent); }
.hint--fallback .hint-label { color: var(--amber); }
.hint--error    .hint-label { color: var(--red); }
.hint--done     .hint-label { color: var(--green); }

.hint-close {
  background: transparent;
  border: 0;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0 4px;
}
.hint-close:hover { color: var(--text); }

.hint-reason {
  margin: 0;
  color: var(--text);
  min-height: 2.6em;
}

.hint-progress {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}
.hint-progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.12);
  transition: background 200ms ease;
}
.hint-progress-dot--done { background: currentColor; }
.hint--logic .hint-progress-dot--done    { background: var(--text); }
.hint--mark .hint-progress-dot--done     { background: var(--accent); }
.hint--fallback .hint-progress-dot--done { background: var(--amber); }

.hint-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.hint-btn {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1.5px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 700;
  transition: all 120ms ease;
}
.hint-btn:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); }
.hint-btn:disabled { opacity: 0.35; cursor: default; }

.hint-btn--primary {
  background: currentColor;
  border-color: currentColor;
  color: var(--bg);
}
.hint--logic .hint-btn--primary { background: var(--text); border-color: var(--text); color: var(--bg); }
.hint--mark  .hint-btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.hint--fallback .hint-btn--primary { background: var(--amber); border-color: var(--amber); color: #fff; }
.hint-btn--primary:hover:not(:disabled) { filter: brightness(1.1); }

/* Transition */
.slide-down-enter-active, .slide-down-leave-active {
  transition: all 0.25s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
