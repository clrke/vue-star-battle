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
  /** Hint-step highlight flags (subtle blue tint, additive at intersections). */
  inHintRow?: boolean
  inHintCol?: boolean
  inHintRegion?: boolean
  isHintExtra?: boolean
  /** Pointer-hover crosshair flags — drawn only on hover-capable devices. */
  inHoverRow?: boolean
  inHoverCol?: boolean
  /** Keyboard-focus cursor — renders a blue ring around this cell. */
  isFocused?: boolean
  /** True if this cell belongs to a satisfied (1-star, no-violation) row,
   *  column, or region — triggers the gold shimmer overlay. */
  inCompleteLine?: boolean
  /** Cell's diagonal index (row + col), used to phase-shift the shimmer
   *  animation so the gold appears to sweep diagonally across the board
   *  rather than every cell flashing in unison. */
  shimmerIndex?: number
}>()

const emit = defineEmits<{
  toggleStar: []
  toggleMark: []
  hover: []
}>()

/** Mouse-only hover signal; touch synthesizes mouseenter on tap, which
 *  would leave a sticky crosshair after the user lifts their finger. */
function handlePointerEnter(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  emit('hover')
}

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

import { computed } from 'vue'

// ── Hint highlight overlays ─────────────────────────────────────────────────
// Three distinct visual treatments so each entity reads differently:
//   • Region → amber tint + amber outline drawn around the region's perimeter
//   • Row/col → soft blue cell-level tint, additive at row∩col intersections
//   • Extra cells → dashed violet ring inside the cell

/** Box-shadow string that paints amber strokes only on the region's outer edges. */
const regionOutlineShadow = computed(() => {
  if (!props.inHintRegion) return ''
  const c = 'var(--amber)'   // resolved at paint time — dark mode adapts automatically
  const w = '3px'
  const parts: string[] = []
  if (props.borders.top)    parts.push(`inset 0 ${w} 0 ${c}`)
  if (props.borders.right)  parts.push(`inset -${w} 0 0 ${c}`)
  if (props.borders.bottom) parts.push(`inset 0 -${w} 0 ${c}`)
  if (props.borders.left)   parts.push(`inset ${w} 0 0 ${c}`)
  return parts.join(', ')
})

/** Row + col stack count (0–2) for the additive blue tint. */
const lineHighlightStrength = computed(() =>
  (props.inHintRow ? 1 : 0) + (props.inHintCol ? 1 : 0),
)

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
    @pointerenter="handlePointerEnter"
    @touchstart.passive="handleTouchStart"
    @touchmove.passive="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchCancel"
  >
    <!-- Completion shimmer: a gold bright-band that sweeps directionally
         across any satisfied row / column / region.
         The element is ALWAYS rendered and its animation is ALWAYS
         running — visibility is gated only by opacity (1 when the cell
         belongs to a complete line, 0 otherwise). That way the wave
         doesn't have to "start" the moment the player completes a line;
         it's already in progress, so the cell just fades in to reveal
         whatever phase the wave happens to be at right now. No
         ramp-up, no v-if remount.
         The animation-delay is biased by SHIMMER_DELAY_BIAS (a large
         constant — much bigger than any shimmerIndex × step) so every
         effective delay is negative; the browser treats the animation
         as having been running since long before puzzle-load, and
         every cell is in steady state at all times.
         shimmerIndex = col (rows) / row (cols) / Chebyshev from star
         (regions). See src/lib/shimmer.ts for the math + property
         tests that pin down gradient continuity. Sits under the hint
         overlays (z=1) and focus / burst (z=3). -->
    <div
      class="cell__hl-complete"
      :class="{ 'cell__hl-complete--visible': inCompleteLine }"
      :style="({ '--shimmer-delay': `${(shimmerIndex ?? 0) * 80 - 80000}ms` } as Record<string, string>)"
      aria-hidden="true"
    />

    <!-- Region highlight: amber tint + perimeter outline (treats region as one shape) -->
    <div
      v-if="inHintRegion"
      class="cell__hl-region"
      :style="{ boxShadow: regionOutlineShadow }"
      aria-hidden="true"
    />

    <!-- Row / column highlight: soft blue cell tint, additive at intersections -->
    <div
      v-if="inHintRow || inHintCol"
      class="cell__hl-line"
      :style="({ '--hl-line-strength': lineHighlightStrength } as Record<string, number>)"
      aria-hidden="true"
    />

    <!-- Hover crosshair: subtle neutral tint along the hovered row + column.
         Mouse-only; CSS gates the visual to (hover: hover) and (pointer: fine). -->
    <div
      v-if="inHoverRow || inHoverCol"
      class="cell__hl-hover"
      aria-hidden="true"
    />

    <!-- Keyboard focus cursor: blue ring marks the active navigation cell. -->
    <div
      v-if="isFocused"
      class="cell__focus-ring"
      aria-hidden="true"
    />

    <!-- Extra "look at this cell" highlight: dashed violet ring -->
    <div
      v-if="isHintExtra"
      class="cell__hl-extra"
      aria-hidden="true"
    />

    <span v-if="state === 'star'"   class="cell__symbol cell__symbol--star">★</span>
    <span v-else-if="state === 'marked'"      class="cell__dot cell__dot--user" aria-hidden="true" />
    <span v-else-if="state === 'auto-marked'" class="cell__dot cell__dot--auto" aria-hidden="true" />

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
  border: 1px solid var(--border);
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
.border-top    { border-top:    2.5px solid var(--border-strong); }
.border-right  { border-right:  2.5px solid var(--border-strong); }
.border-bottom { border-bottom: 2.5px solid var(--border-strong); }
.border-left   { border-left:   2.5px solid var(--border-strong); }

.cell__symbol {
  font-size: clamp(20px, 6cqi, 48px);
  line-height: 1;
  pointer-events: none;
}

.cell__symbol--star { color: var(--amber); }

/* User-placed mark — solid round dot, 23% of cell width.
   Dots always sit on pastel region backgrounds (same hue in both light and
   dark mode), so we use a fixed dark-semi-transparent colour rather than
   --text (which turns near-white in dark mode and becomes invisible). */
.cell__dot {
  display: block;
  border-radius: 50%;
  pointer-events: none;
}
.cell__dot--user {
  width: 23%;
  height: 23%;
  background: rgba(26, 26, 46, 0.62);
}
/* Derived auto-mark — subtler than the user dot to signal "computed". */
.cell__dot--auto {
  width: 16%;
  height: 16%;
  background: rgba(26, 26, 46, 0.32);
}

/* Auto-marks are locked: dim them and skip the hover/active feedback */
.cell--auto-marked { cursor: default; }
.cell--auto-marked:hover { filter: none; }
.cell--auto-marked:active { filter: none; }

/* Violation highlight */
.cell--violated .cell__symbol--star { color: var(--red); }
.cell--violated::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(192, 57, 43, 0.18);
  pointer-events: none;
  z-index: 2;
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

/* ── Hint-step highlights ──────────────────────────────────────────────────
 *
 *  Region:  amber tint + amber outline along the region's outer perimeter.
 *           The outline is built per-cell from `borders` flags via inset
 *           box-shadows; adjacent in-region cells form one continuous outline.
 *  Line:    soft blue cell tint for highlighted rows / columns, opacity
 *           additive at row∩column intersections.
 *  Extra:   dashed violet ring on a single supporting cell (e.g. the source
 *           star for an "adjacent" hint).
 *
 * Different colors + different shapes ⇒ each entity reads distinctly when
 * stacked on the same cell.
 */
.cell__hl-region {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: rgba(243, 156, 18, 0.16);
  transition: background 200ms ease;
}

.cell__hl-line {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: rgba(41, 128, 185, calc(0.12 + 0.12 * var(--hl-line-strength)));
  transition: background 200ms ease;
}

/* Hover crosshair — subtle neutral darkening so it composes over the
 * pastel region colors in both light and dark modes. Only painted on
 * devices that actually have hover (skips touch / stylus). */
.cell__hl-hover {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: rgba(0, 0, 0, 0.07);
  display: none;
}
@media (hover: hover) and (pointer: fine) {
  .cell__hl-hover { display: block; }
}

.cell__hl-extra {
  position: absolute;
  inset: 12%;
  pointer-events: none;
  z-index: 2;
  border: 2.5px dashed var(--violet);
  border-radius: 6px;
}

/* Completion shimmer: a static gold tint + a directional bright band
 * that sweeps L→R across rows (T→B across columns). The background
 * image is 11× the cell width so any one moment shows ~1/11 of the
 * gradient. Per-cell animation-delay (= shimmerIndex × 80 ms = cycle /
 * (IMG − 1)) is exactly tuned so cell N+1's image-left is cell N's
 * image-left − 1 at every moment — the cells' gradients align across
 * boundaries and together render one continuous wave band. The
 * gradient stops are placed in a narrow window (47 % − 53 %) so the
 * bright peak is roughly half a cell wide, sweeping the whole line in
 * about 800 ms. See src/lib/shimmer.ts for the math + property tests.
 *
 * The element is ALWAYS rendered with the animation always running, so
 * by the time the player completes a line, the wave is already in
 * steady state. Visibility is controlled purely by opacity — adding
 * the `--visible` modifier fades the gold band in over 250 ms,
 * revealing whatever phase the wave happens to be at, with no
 * ramp-up. The inline --shimmer-delay subtracts a large bias so every
 * effective delay is negative; that bias keeps every cell already in
 * cycle even at puzzle-load, which is critical because animation
 * timelines are anchored to element mount time.
 *
 * z-index 0 keeps it above the region background but below the hint
 * overlays (z=1) and focus / burst (z=3). */
.cell__hl-complete {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  transition: opacity 250ms ease-out;
  background: linear-gradient(
    225deg,
    transparent       0%,
    transparent      40%,
    rgba(247, 201, 72, 0.55) 50%,
    transparent      60%,
    transparent     100%
  );
  background-size: 1100% 100%;
  background-repeat: no-repeat;
  animation: shimmer-gold 0.8s linear infinite;
  animation-delay: var(--shimmer-delay, 0ms);
}

.cell__hl-complete--visible {
  opacity: 1;
}

@keyframes shimmer-gold {
  0%   { background-position: 100% 0, 0 0; }
  100% { background-position:   0% 0, 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .cell__hl-complete {
    animation: none;
    background: rgba(247, 201, 72, 0.20);
    transition: opacity 250ms ease-out;
  }
}

/* Keyboard navigation cursor: thin blue ring, z-index above hint highlights. */
.cell__focus-ring {
  position: absolute;
  inset: 2px;
  pointer-events: none;
  z-index: 3;
  border: 2px solid var(--accent);
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--accent-glow);
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
