<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import type { DisplayCellState, BorderEdges } from '../types/puzzle'

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
  state: DisplayCellState
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

// ── Star-burst animation ───────────────────────────────────────────────────
// One-shot ring + 8 outward-flying particles when a star is placed correctly.
// Suppressed on violations so the burst always reads as "good move".

const burstActive = ref(false)
let burstTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.state,
  (next, prev) => {
    if (next === 'star' && prev !== 'star' && !props.isViolated) {
      if (burstTimer) clearTimeout(burstTimer)
      burstActive.value = true
      burstTimer = setTimeout(() => { burstActive.value = false; burstTimer = null }, 700)
    }
  },
)

onUnmounted(() => {
  clearPendingTap()
  if (burstTimer) clearTimeout(burstTimer)
})
</script>

<template>
  <div
    class="cell"
    :class="{
      'cell--star': state === 'star',
      'cell--marked': state === 'marked',
      'cell--auto-marked': state === 'auto-marked',
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
    <span v-else-if="state === 'marked'"      class="cell__symbol cell__symbol--mark">·</span>
    <span v-else-if="state === 'auto-marked'" class="cell__symbol cell__symbol--auto">·</span>

    <div v-if="burstActive" class="cell__burst" aria-hidden="true">
      <span class="cell__burst-ring" />
      <span
        v-for="i in 8" :key="i"
        class="cell__burst-particle"
        :style="{ '--angle': `${(i - 1) * 45}deg` }"
      />
    </div>
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
.cell__symbol--auto { color: #b5b5b5; font-size: clamp(12px, 4cqi, 28px); opacity: 0.85; }

/* Auto-marks are locked: dim them and skip the hover/active feedback */
.cell--auto-marked { cursor: default; }
.cell--auto-marked:hover { filter: none; }
.cell--auto-marked:active { filter: none; }

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

/* Star-burst: a one-shot expanding ring + 8 outward-flying particles. */
.cell__burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}

.cell__burst-ring {
  position: absolute;
  inset: 10%;
  border-radius: 50%;
  border: 3px solid #f1c40f;
  animation: burst-ring 700ms ease-out forwards;
  will-change: transform, opacity;
}

.cell__burst-particle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: #f39c12;
  box-shadow: 0 0 4px rgba(243, 156, 18, 0.6);
  animation: burst-particle 700ms cubic-bezier(0.2, 0.7, 0.4, 1) forwards;
  will-change: transform, opacity;
}

@keyframes burst-ring {
  0%   { transform: scale(0.4); opacity: 0.95; }
  100% { transform: scale(2.0); opacity: 0;    }
}

@keyframes burst-particle {
  0%   { transform: rotate(var(--angle)) translateY(0) scale(1);   opacity: 1; }
  60%  { opacity: 1; }
  100% { transform: rotate(var(--angle)) translateY(-32px) scale(0.2); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .cell__burst-ring,
  .cell__burst-particle { animation: none; opacity: 0; }
}
</style>
