<script setup lang="ts">
import { onUnmounted } from 'vue'
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

defineProps<{
  regionId: number
  state: CellState
  borders: BorderEdges
  isViolated: boolean
  isHint: boolean
  hintAction: 'place-star' | 'place-mark' | null
}>()

const emit = defineEmits<{
  toggleStar: []
  toggleMark: []
}>()

/* ------------------------------------------------------------------------- *
 * Touch gesture detection
 *
 * On a touch device:
 *   • single tap → toggle MARK (dot)
 *   • double tap → toggle STAR (within 280 ms of the first tap)
 *
 * On a mouse:
 *   • left click  → toggle STAR
 *   • right click → toggle MARK
 *
 * The two paths are kept separate via the pointerType / preventDefault dance:
 * touchend calls preventDefault, which suppresses the synthesized mouse
 * `click` event that would otherwise follow.
 * ------------------------------------------------------------------------- */

const DOUBLE_TAP_WINDOW_MS = 280
const TAP_MOVE_TOLERANCE_PX = 10

let tapTimer: ReturnType<typeof setTimeout> | null = null
let lastTapAt = 0
let touchStart: { x: number; y: number } | null = null
let touchMoved = false

function clearPendingTap() {
  if (tapTimer) { clearTimeout(tapTimer); tapTimer = null }
  lastTapAt = 0
}

function handleTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) {
    clearPendingTap()
    return
  }
  const t = e.touches[0]
  touchStart = { x: t.clientX, y: t.clientY }
  touchMoved = false
}

function handleTouchMove(e: TouchEvent) {
  if (!touchStart || e.touches.length !== 1) return
  const t = e.touches[0]
  const dx = t.clientX - touchStart.x
  const dy = t.clientY - touchStart.y
  if (dx * dx + dy * dy > TAP_MOVE_TOLERANCE_PX * TAP_MOVE_TOLERANCE_PX) {
    touchMoved = true
  }
}

function handleTouchEnd(e: TouchEvent) {
  if (!touchStart || touchMoved) {
    touchStart = null
    return
  }
  // Suppress the synthesized mouse `click` that follows touchend.
  e.preventDefault()
  touchStart = null

  const now = Date.now()
  if (tapTimer && now - lastTapAt < DOUBLE_TAP_WINDOW_MS) {
    // Second tap inside the window → double-tap
    clearPendingTap()
    emit('toggleStar')
  } else {
    // First tap — wait briefly to see if a second one arrives
    lastTapAt = now
    tapTimer = setTimeout(() => {
      tapTimer = null
      lastTapAt = 0
      emit('toggleMark')
    }, DOUBLE_TAP_WINDOW_MS)
  }
}

function handleTouchCancel() {
  touchStart = null
  touchMoved = false
}

// Desktop mouse paths
function handleClick() { emit('toggleStar') }
function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  emit('toggleMark')
}

onUnmounted(clearPendingTap)
</script>

<template>
  <div
    class="cell"
    :class="{
      'cell--star': state === 'star',
      'cell--marked': state === 'marked',
      'cell--violated': isViolated,
      'cell--hint': isHint,
      'cell--hint-mark': isHint && hintAction === 'place-mark',
      'border-top': borders.top,
      'border-right': borders.right,
      'border-bottom': borders.bottom,
      'border-left': borders.left,
    }"
    :style="{ backgroundColor: REGION_COLORS[regionId % REGION_COLORS.length] }"
    @click="handleClick"
    @contextmenu="handleContextMenu"
    @touchstart.passive="handleTouchStart"
    @touchmove.passive="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchCancel"
  >
    <span v-if="state === 'star'"   class="cell__symbol cell__symbol--star">★</span>
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
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  /* Disable double-tap-zoom & 300ms click delay on mobile */
  touch-action: manipulation;
}

.cell:hover { filter: brightness(0.93); }
.cell:active { filter: brightness(0.85); }

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

.cell__symbol--star { color: #1a1a2e; }
.cell__symbol--mark { color: #777; font-size: clamp(18px, 6cqi, 44px); }

/* Violation highlight */
.cell--violated .cell__symbol--star { color: #c0392b; }
.cell--violated::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(192, 57, 43, 0.12);
  pointer-events: none;
}

/* Hint pulse — gold for star placement, blue for mark suggestion */
@keyframes hint-pulse-star {
  0%, 100% { box-shadow: inset 0 0 0 3px #f39c12; }
  50%      { box-shadow: inset 0 0 0 3px #f1c40f, 0 0 12px 4px rgba(243, 156, 18, 0.5); }
}
@keyframes hint-pulse-mark {
  0%, 100% { box-shadow: inset 0 0 0 3px #2980b9; }
  50%      { box-shadow: inset 0 0 0 3px #3498db, 0 0 12px 4px rgba(41, 128, 185, 0.5); }
}
.cell--hint {
  animation: hint-pulse-star 0.6s ease-in-out infinite;
  z-index: 1;
}
.cell--hint-mark {
  animation: hint-pulse-mark 0.6s ease-in-out infinite;
}
</style>
