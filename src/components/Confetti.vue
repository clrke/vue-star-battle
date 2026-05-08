<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps<{ active: boolean }>()
const emit  = defineEmits<{ done: [] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let rafId: number | null = null

const COLORS = [
  '#f7c948', '#e94f37', '#27ae60', '#3498db',
  '#9b59b6', '#e67e22', '#1abc9c', '#e91e63',
]

interface Particle {
  x: number; y: number
  vx: number; vy: number
  rotation: number; rotSpeed: number
  color: string
  w: number; h: number
  opacity: number
  decay: number
}

function stop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  const cvs = canvas.value
  if (cvs) cvs.getContext('2d')?.clearRect(0, 0, cvs.width, cvs.height)
}

function launch() {
  stop()
  const cvs = canvas.value
  if (!cvs) return

  cvs.width  = window.innerWidth
  cvs.height = window.innerHeight
  const ctx  = cvs.getContext('2d')!

  const particles: Particle[] = []
  const cx = cvs.width / 2
  const cy = cvs.height * 0.55

  for (let i = 0; i < 140; i++) {
    // Weighted-upward burst: π/2 ± 80° (mostly upward, some sideways)
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6
    const speed = 6 + Math.random() * 15
    particles.push({
      x: cx + (Math.random() - 0.5) * 140,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.25,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      w: 9 + Math.random() * 7,
      h: 4 + Math.random() * 4,
      opacity: 1,
      decay: 0.007 + Math.random() * 0.007,
    })
  }

  const GRAVITY = 0.35
  // Capture dimensions in const closures — TS loses null-narrowing on `cvs`
  // inside the nested tick() function, so reading cvs.width there errors.
  const W = cvs.width
  const H = cvs.height

  function tick() {
    ctx.clearRect(0, 0, W, H)
    let alive = 0

    for (const p of particles) {
      if (p.opacity <= 0) continue
      alive++
      p.vy       += GRAVITY
      p.x        += p.vx
      p.y        += p.vy
      p.vx       *= 0.99        // light air resistance
      p.rotation += p.rotSpeed
      p.opacity  -= p.decay

      ctx.save()
      ctx.globalAlpha = Math.max(0, p.opacity)
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }

    if (alive > 0) {
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = null
      emit('done')
    }
  }

  rafId = requestAnimationFrame(tick)
}

watch(() => props.active, (v) => { if (v) launch(); else stop() })
onUnmounted(stop)
</script>

<template>
  <canvas ref="canvas" class="confetti-canvas" />
</template>

<style scoped>
.confetti-canvas {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
}
</style>
