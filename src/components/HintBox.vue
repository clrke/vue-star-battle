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
    case 'common-neighbor-col': return 'hint--mark'
    case 'fallback':         return 'hint--fallback'
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
  return lastHint.value.action === 'place-star' ? 'Place ★' : 'Place dot'
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
  border-left: 4px solid #2980b9;
  background: #f6fafd;
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 0.85rem;
  line-height: 1.55;
  position: relative;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.hint--logic    { border-color: #1a1a2e; background: #f0f1f7; }
.hint--mark     { border-color: #2980b9; background: #eef6fb; }
.hint--fallback { border-color: #f39c12; background: #fdf6ec; }
.hint--error    { border-color: #c0392b; background: #fbeeec; }
.hint--done     { border-color: #27ae60; background: #ecf8ef; }

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
  color: #1a1a2e;
}
.hint-step-counter {
  font-weight: 600;
  color: #888;
  letter-spacing: 0.04em;
}
.hint--mark     .hint-label { color: #2980b9; }
.hint--fallback .hint-label { color: #e67e22; }
.hint--error    .hint-label { color: #c0392b; }
.hint--done     .hint-label { color: #27ae60; }

.hint-close {
  background: transparent;
  border: 0;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  color: #999;
  padding: 0 4px;
}
.hint-close:hover { color: #333; }

.hint-reason {
  margin: 0;
  color: #333;
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
.hint--logic .hint-progress-dot--done    { background: #1a1a2e; }
.hint--mark .hint-progress-dot--done     { background: #2980b9; }
.hint--fallback .hint-progress-dot--done { background: #e67e22; }

.hint-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.hint-btn {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1.5px solid #ccc;
  background: #fff;
  color: #555;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 700;
  transition: all 120ms ease;
}
.hint-btn:hover:not(:disabled) { border-color: #888; color: #222; }
.hint-btn:disabled { opacity: 0.35; cursor: default; }

.hint-btn--primary {
  background: currentColor;
  border-color: currentColor;
  color: #fff;
}
.hint--logic .hint-btn--primary { background: #1a1a2e; border-color: #1a1a2e; color: #fff; }
.hint--mark  .hint-btn--primary { background: #2980b9; border-color: #2980b9; color: #fff; }
.hint--fallback .hint-btn--primary { background: #e67e22; border-color: #e67e22; color: #fff; }
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
