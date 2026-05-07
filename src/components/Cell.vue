<script setup lang="ts">
import type { CellState, BorderEdges } from '../types/puzzle'

const REGION_COLORS = [
  '#ffd6d6', // 0  rose
  '#ffe8c4', // 1  peach
  '#fff5c0', // 2  yellow
  '#cff5ce', // 3  mint
  '#c8e6ff', // 4  sky
  '#ddd0ff', // 5  lavender
  '#ffd0f7', // 6  pink-purple
  '#c8fff2', // 7  aqua
  '#e0ffc8', // 8  lime
  '#ffc8d8', // 9  salmon
  '#c8d0ff', // 10 periwinkle
  '#f5e8c0', // 11 sand
]

const props = defineProps<{
  regionId: number
  state: CellState
  borders: BorderEdges
  isViolated: boolean
  isHint: boolean
}>()

const emit = defineEmits<{
  click: []
  contextmenu: []
}>()

function handleClick() {
  emit('click')
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  emit('contextmenu')
}
</script>

<template>
  <div
    class="cell"
    :class="{
      'cell--star': state === 'star',
      'cell--marked': state === 'marked',
      'cell--violated': isViolated,
      'cell--hint': isHint,
      'border-top': borders.top,
      'border-right': borders.right,
      'border-bottom': borders.bottom,
      'border-left': borders.left,
    }"
    :style="{ backgroundColor: REGION_COLORS[regionId % REGION_COLORS.length] }"
    @click="handleClick"
    @contextmenu="handleContextMenu"
  >
    <span v-if="state === 'star'" class="cell__symbol cell__symbol--star">★</span>
    <span v-else-if="state === 'marked'" class="cell__symbol cell__symbol--mark">·</span>
  </div>
</template>

<style scoped>
.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid rgba(0, 0, 0, 0.15);
  transition: filter 80ms ease;
  user-select: none;
}

.cell:hover {
  filter: brightness(0.93);
}

/* Thick region-boundary borders */
.border-top    { border-top:    2.5px solid #222; }
.border-right  { border-right:  2.5px solid #222; }
.border-bottom { border-bottom: 2.5px solid #222; }
.border-left   { border-left:   2.5px solid #222; }

.cell__symbol {
  font-size: clamp(14px, 4cqi, 32px);
  line-height: 1;
  pointer-events: none;
}

.cell__symbol--star {
  color: #1a1a2e;
}

.cell__symbol--mark {
  color: #777;
  font-size: clamp(18px, 6cqi, 44px);
}

/* Violation highlight */
.cell--violated .cell__symbol--star {
  color: #c0392b;
}

.cell--violated::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(192, 57, 43, 0.12);
  pointer-events: none;
}

/* Hint pulse */
@keyframes hint-pulse {
  0%, 100% { box-shadow: inset 0 0 0 3px #f39c12; }
  50%       { box-shadow: inset 0 0 0 3px #f1c40f, 0 0 12px 4px rgba(243, 156, 18, 0.5); }
}

.cell--hint {
  animation: hint-pulse 0.6s ease-in-out infinite;
  z-index: 1;
}
</style>
