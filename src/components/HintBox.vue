<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'

const game = useGameStore()
const { lastHint } = storeToRefs(game)

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
    case 'mark-col':         return 'hint--mark'
    case 'fallback':         return 'hint--fallback'
    case 'contradiction':    return 'hint--error'
    case 'already-solved':   return 'hint--done'
    default:                 return ''
  }
})

function dismiss() {
  game.clearHint()
}
</script>

<template>
  <Transition name="slide-down">
    <div v-if="visible && lastHint" class="hint-box" :class="variantClass">
      <div class="hint-header">
        <span class="hint-label">{{ lastHint.label }}</span>
        <button class="hint-close" @click="dismiss" aria-label="Dismiss hint">×</button>
      </div>
      <p class="hint-reason">{{ lastHint.reason }}</p>
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
}

.hint-label {
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #1a1a2e;
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
}

/* Transition */
.slide-down-enter-active, .slide-down-leave-active {
  transition: all 0.25s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
